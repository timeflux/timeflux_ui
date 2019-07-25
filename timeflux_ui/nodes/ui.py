import logging
import os
import numpy as np
import pandas as pd
import asyncio
import socketio
from aiohttp import web
from threading import Thread, Lock
from timeflux.helpers import clock
from timeflux.core.node import Node


class UI(Node):

    """Interact with Timeflux from the browser.

    This node provides a web interface, available at ``http://localhost:8000`` by
    default. Bi-directional communication is possible through the WebSocket protocol.

    A real-time data stream visualization application is provided at
    ``http://localhost:8000/monitor/``. More applications are coming.

    This node accepts any number of named input ports. The default output port forwards
    the events received from the browser.

    Attributes:
        i_* (Port): Dynamic inputs, expect DataFrame.
        o (Port): Default output, provide DataFrame.

    Example:
        .. literalinclude:: /../../timeflux_ui/test/graphs/ui.yaml
           :language: yaml

    """

    def __init__(self, host='localhost', port=8000, routes={}, debug=False):

        """
        Args:
            host (string): The host to bind to.
            port (int): The port to listen to.
            routes (dict): A dictionary of custom web apps. Key is the name, value is the path.
            debug (bool): Show dependencies debug information.
        """

        self._root = os.path.join(os.path.dirname(__file__), '../www')
        self._streams = {}
        self._events = {}
        self._lock = Lock()

        # Debug
        if not debug:
            logging.getLogger('asyncio').setLevel(logging.WARNING)
            logging.getLogger('aiohttp.access').setLevel(logging.WARNING)
            logging.getLogger('engineio').setLevel(logging.WARNING)
            logging.getLogger('socketio').setLevel(logging.WARNING)

        # HTTP
        app = web.Application()
        app.router.add_static('/common/assets/', self._root + '/common/assets')
        app.router.add_static('/monitor/assets/', self._root + '/monitor/assets')
        app.add_routes([
            web.get('/', self._route_index),
            web.get('/{default}', self._route_default)
        ])

        # Apps
        self._routes = { 'monitor': self._root + '/monitor' }
        self._routes.update(routes)
        for name, path in self._routes.items():
            try:
                app.router.add_static(f'/{name}/assets/', f'{path}/assets')
            except ValueError:
                pass
            app.add_routes([web.get(f'/{name}/', self._route_app)])

        # Websocket
        self._sio = socketio.AsyncServer()
        self._sio.attach(app)
        self._sio.on('connect', self._on_connect)
        self._sio.on('disconnect', self._on_disconnect)
        self._sio.on('subscribe', self._on_subscribe)
        self._sio.on('unsubscribe', self._on_unsubscribe)
        self._sio.on('event', self._on_event)

        # Do not block
        # https://stackoverflow.com/questions/51610074/how-to-run-an-aiohttp-server-in-a-thread
        handler = app.make_handler()
        self._loop = asyncio.get_event_loop()
        server = self._loop.create_server(handler, host=host, port=port)
        Thread(target=self._run, args=(server,)).start()
        self.logger.info('UI available at http://%s:%d' % (host, port))


    def _run(self, server):
        self._loop.run_until_complete(server)
        self._loop.run_forever()

    async def _route_index(self, request):
        raise web.HTTPFound('/monitor/')

    async def _route_default(self, request):
        raise web.HTTPFound(request.path + '/')

    async def _route_app(self, request):
        name = request.path.strip('/')
        try:
            with open(self._routes[name] + '/index.html') as f:
                return web.Response(text=f.read(), content_type='text/html')
        except:
            raise web.HTTPNotFound()

    async def _on_connect(self, sid, environ):
        self.logger.debug('Connect: %s', sid)
        await self._sio.emit('streams', self._streams, room=sid)

    def _on_disconnect(self, sid):
        self.logger.debug('Disconnect: %s', sid)

    def _on_subscribe(self, sid, data):
        self.logger.debug('Subscribe: %s to %s', sid, data)
        self._sio.enter_room(sid, data)

    def _on_unsubscribe(self, sid, data):
        self.logger.debug('Unsubscribe: %s from %s', sid, data)
        self._sio.leave_room(sid, data)

    def _on_event(self, sid, data):
        now = clock.now()
        if not self._events:
            self._events = {'label': [], 'data': [], 'time': []}
        self._events['label'].append(data['label'])
        self._events['data'].append(data['data'])
        self._events['time'].append(now)


    async def _emit(self, event, data, room):
        await self._sio.emit(event, data, room=room)

    def _send(self, event, data, room=None):
        # https://docs.python.org/3/library/asyncio-dev.html#concurrency-and-multithreading
        asyncio.run_coroutine_threadsafe(self._emit(event, data, room), self._loop)

    def _convert(self, data):
        data = data.copy()
        data['index'] = (data.index.values.astype(np.float64) / 1e6).astype(np.int64) # from ns to ms
        data.drop_duplicates(subset='index', keep='last', inplace=True) # remove duplicate indices
        data.set_index('index', inplace=True) # replace index
        data = data.to_dict(orient='index') # export to dict
        return data

    def _add_stream(self, name, data):
        if not name in self._streams:
            self._streams[name] = list(data.columns)
            self._send('streams', self._streams)

    def update(self):
        # Send input to WebSocket
        for name, port in self.ports.items():
            if name.startswith('i_'):
                if port.data is not None:
                    room = name[2:]
                    data = {
                        'name': room,
                        'samples': self._convert(port.data)
                    }
                    self._add_stream(room, port.data)
                    self._send('data', data, room)
        # Send events from WebSocket to output
        if self._events:
            self.o.data = pd.DataFrame({'label': self._events['label'], 'data': self._events['data']}, self._events['time'])
            self._events = {}

    def terminate(self):
        self._loop.call_soon_threadsafe(self._loop.stop)
