import logging
import sys
import os
import json
import numpy as np
import pandas as pd
import asyncio
from aiohttp import web
from threading import Thread
from timeflux.helpers import clock
from timeflux.core.node import Node
from timeflux.core.exceptions import WorkerLoadError


class UI(Node):

    """Interact with Timeflux from the browser.

    This node provides a web interface, available at ``http://localhost:8000`` by
    default. Bi-directional communication is available through the WebSocket protocol.

    A real-time data stream visualization application is provided at
    ``http://localhost:8000/monitor/``. Other example applications (such as P300 and
    EEG signal quality) are provided in the ``apps`` directory of this package.

    This node accepts any number of named input ports. Streams received from the browser
    are forwarded to output ports.

    Attributes:
        i_* (Port): Dynamic inputs, expect DataFrame.
        o_* (Port): Dynamic outputs, provide DataFrame.

    Example:
        .. literalinclude:: /../examples/ui.yaml
           :language: yaml

    """

    def __init__(
        self, host="localhost", port=8000, routes={}, settings={}, debug=False
    ):

        """
        Args:
            host (string): The host to bind to.
            port (int): The port to listen to.
            routes (dict): A dictionary of custom web apps. Key is the name, value is the path.
            settings (dict): An arbitrary configuration file that will be exposed to web apps.
            debug (bool): Show dependencies debug information.
        """

        self._root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "www")
        )
        self._clients = {}
        self._subscriptions = {}
        self._streams = {}
        self._buffer = {}

        # Debug
        if not debug:
            logging.getLogger("asyncio").setLevel(logging.WARNING)
            logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

        # HTTP
        app = web.Application()
        app.router.add_static("/common/assets/", self._root + "/common/assets")
        app.router.add_static("/monitor/assets/", self._root + "/monitor/assets")
        app.add_routes(
            [
                web.get("/", self._route_index),
                web.get("/ws", self._route_ws),
                web.get("/settings.json", self._route_settings),
                web.get("/{default}", self._route_default),
            ]
        )

        # Apps
        self._routes = {"monitor": self._root + "/monitor"}
        for name, path in routes.items():
            self._routes[name] = self._find_path(path)
        for name, path in self._routes.items():
            try:
                app.router.add_static(f"/{name}/assets/", f"{path}/assets")
            except ValueError:
                pass
            app.add_routes([web.get(f"/{name}/", self._route_app)])

        # Settings
        self._settings = json.dumps(settings)

        # Do not block
        # https://stackoverflow.com/questions/51610074/how-to-run-an-aiohttp-server-in-a-thread
        handler = app.make_handler()
        self._loop = asyncio.get_event_loop()
        server = self._loop.create_server(handler, host=host, port=port)
        Thread(target=self._run, args=(server,)).start()
        self.logger.info("UI available at http://%s:%d" % (host, port))

    def _find_path(self, path):
        path = os.path.normpath(path)
        if os.path.isabs(path):
            if os.path.isdir(path):
                return path
        else:
            for base in sys.path:
                full_path = os.path.join(base, path)
                if os.path.isdir(full_path):
                    return full_path
        raise WorkerLoadError(
            f"Directory `{path}` could not be found in the search path."
        )

    def _run(self, server):
        self._loop.run_until_complete(server)
        self._loop.run_forever()

    async def _route_index(self, request):
        raise web.HTTPFound("/monitor/")

    async def _route_ws(self, request):
        ws = web.WebSocketResponse()
        if "uuid" not in request.rel_url.query:
            return ws
        uuid = request.rel_url.query["uuid"]
        self._clients[uuid] = {"socket": ws, "subscriptions": set()}
        await ws.prepare(request)
        await self._on_connect(uuid)
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await self._on_message(uuid, msg)
        self._on_disconnect(uuid)
        return ws

    async def _route_settings(self, request):
        return web.Response(text=self._settings)

    async def _route_default(self, request):
        raise web.HTTPFound(request.path + "/")

    async def _route_app(self, request):
        name = request.path.strip("/")
        try:
            with open(self._routes[name] + "/index.html") as f:
                return web.Response(text=f.read(), content_type="text/html")
        except:
            raise web.HTTPNotFound()

    async def _on_connect(self, uuid):
        self.logger.debug("Connect: %s", uuid)
        await self._send("streams", self._streams, uuid=uuid)

    def _on_disconnect(self, uuid):
        for subscription in self._clients[uuid]["subscriptions"].copy():
            self._on_unsubscribe(uuid, subscription)
        del self._clients[uuid]
        self.logger.debug("Disconnect: %s", uuid)

    async def _on_message(self, uuid, message):
        try:
            message = message.json()
            if "command" not in message or "payload" not in message:
                message = False
        except json.decoder.JSONDecodeError:
            message = False
        if not message:
            self.logger.warn("Received an invalid JSON message from %s", uuid)
            return
        if "ack" in message and message["ack"]:
            await self._send("ack", message["ack"], uuid=uuid)
        if message["command"] == "subscribe":
            self._on_subscribe(uuid, message["payload"])
        elif message["command"] == "unsubscribe":
            self._on_unsubscribe(uuid, message["payload"])
        elif message["command"] == "publish":
            await self._on_publish(
                message["payload"]["name"],
                message["payload"]["data"],
                message["payload"]["meta"],
            )
            await self._send(
                "stream", message["payload"], topic=message["payload"]["name"]
            )
        elif message["command"] == "sync":
            # TODO
            pass

    def _on_subscribe(self, uuid, topic):
        self.logger.debug("Subscribe: %s to %s", uuid, topic)
        self._clients[uuid]["subscriptions"].add(topic)
        if topic not in self._subscriptions:
            self._subscriptions[topic] = {uuid}
        else:
            self._subscriptions[topic].add(uuid)

    def _on_unsubscribe(self, uuid, topic):
        self.logger.debug("Unsubscribe: %s from %s", uuid, topic)
        self._clients[uuid]["subscriptions"].discard(topic)
        if topic not in self._subscriptions:
            return
        if uuid not in self._subscriptions[topic]:
            return
        self._subscriptions[topic].discard(uuid)
        if len(self._subscriptions[topic]) == 0:
            del self._subscriptions[topic]

    async def _on_publish(self, name, data, meta):
        if name not in self._streams:
            channels = list(list(data.values())[0].keys()) if data else []
            await self._add_stream(name, channels)
            self._buffer[name] = {"data": {}, "meta": None}
        if data:
            self._buffer[name]["data"].update(data)
        if meta:
            self._buffer[name]["meta"] = meta

    async def _send(self, command, payload, uuid=None, topic=None):
        message = json.dumps({"command": command, "payload": payload})
        if not uuid and not topic:
            # Broadcast to all clients
            for uuid in self._clients:
                if self._is_alive(uuid):
                    await self._clients[uuid]["socket"].send_str(message)
        if uuid:
            # Send to one client
            if self._is_alive(uuid):
                await self._clients[uuid]["socket"].send_str(message)
        if topic:
            # Send to all this topic's subscribers
            if topic in self._subscriptions:
                for uuid in self._subscriptions[topic]:
                    if self._is_alive(uuid):
                        await self._clients[uuid]["socket"].send_str(message)
        self._dispose()

    def _dispose(self):
        """Get rid of dead connections"""
        for uuid in self._clients.copy():
            if not self._is_alive(uuid):
                self._on_disconnect(uuid)

    def _is_alive(self, uuid):
        """Check if a socket is alive"""
        # On Linux, client disconnections are not properly detected.
        # This method should be used before each send_* to avoid (uncatchable) exceptions,
        # memory leaks, and catastrophic failure.
        # This is a hotfix while waiting for the issue to be resolved upstream.
        return False if self._clients[uuid]["socket"]._req.transport is None else True

    def _to_dict(self, data):
        # Some users report a warning ("A value is trying to be set on a copy of a slice
        # from a DataFrame"). I was not able to reproduce the behavior, but the
        # data.copy() instruction seems to fix the issue, although it is somewhat
        # probably impacting memory. This should be investigated further.
        # See: https://stackoverflow.com/questions/20625582/how-to-deal-with-settingwithcopywarning-in-pandas
        data = data.copy()  # Remove?
        data["index"] = (data.index.values.astype(np.float64) / 1e6).astype(
            np.int64
        )  # from ns to ms
        data.drop_duplicates(
            subset="index", keep="last", inplace=True
        )  # remove duplicate indices
        data.set_index("index", inplace=True)  # replace index
        data = data.to_dict(orient="index")  # export to dict
        return data

    def _from_dict(self, data):
        try:
            data = pd.DataFrame.from_dict(data, orient="index")
            data.index = pd.to_datetime(data.index, unit="ms")
        except ValueError:
            self.logger.warn("Invalid stream data")
            return None
        return data

    async def _add_stream(self, name, channels):
        if name in self._streams:
            return
        self._streams[name] = channels
        await self._send("streams", self._streams)

    async def _get_buffer_keys(self):
        return list(self._buffer)

    async def _get_buffer_value(self, name):
        data = self._buffer[name]["data"]
        meta = self._buffer[name]["meta"]
        self._buffer[name] = {"data": {}, "meta": None}
        return data, meta

    def _run_safe(self, coroutine, wait=True):
        # https://docs.python.org/3/library/asyncio-dev.html#concurrency-and-multithreading
        future = asyncio.run_coroutine_threadsafe(coroutine, self._loop)
        return future.result() if wait else future

    def update(self):
        # Forward node input streams to WebSocket
        for name, port in self.ports.items():
            if name.startswith("i_"):
                if port.data is not None:
                    stream = name[2:]
                    data = {
                        "name": stream,
                        "data": self._to_dict(port.data),
                        "meta": port.meta,
                    }
                    self._run_safe(self._add_stream(stream, list(port.data.columns)))
                    self._run_safe(self._send("stream", data, topic=stream))
        # Forward WebSocket streams to node output
        for name in self._run_safe(self._get_buffer_keys()):
            try:
                data, meta = self._run_safe(self._get_buffer_value(name))
                if data or meta:
                    getattr(self, "o_" + name).data = self._from_dict(data)
                    getattr(self, "o_" + name).meta = meta
            except KeyError:
                # Buffer has changed
                pass

    def terminate(self):
        self._loop.call_soon_threadsafe(self._loop.stop)
