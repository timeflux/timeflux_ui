import asyncio
import datetime
import pathlib
import threading
import queue
import webbrowser

from timeflux.core.node import Node
from aiohttp import web
import aiohttp_jinja2
import jinja2


class MetadataUI(Node):
    """

    Example

        - id: node_1
          module: timeflux_ui.nodes.meta
          class: MetadataUI
          params:
            port: 8883
            fields:
              email:
                default: hello@example.com
                type: email
              name:
                default: david
              address: # empty

    """

    def __init__(self, host='0.0.0.0', port=8800, fields=None, open_browser=True):
        super().__init__()

        self._fields = fields or dict()

        self._loop = None
        self._queue = queue.Queue()
        self._thread = threading.Thread(target=self._run_server, args=(host, port))
        self._thread.start()
        if open_browser:
            webbrowser.open(f'http://{host}:{port}', new=0, autoraise=True)

    def update(self):
        while not self._queue.empty():
            metadata = self._queue.get()
            self.logger.info('Sending... %s', metadata)
            self.o.meta = metadata

    def terminate(self):
        self._loop.call_soon_threadsafe(self._loop.stop)

    def _run_server(self, host, port):
        self.logger.info('Running server')
        # asyncio setup
        try:
            self._loop = asyncio.get_event_loop()
        except RuntimeError:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)

        root_dir = pathlib.Path(__file__).parent
        www_dir = root_dir / 'www'
        template_dir = root_dir / 'templates'
        js_dir = www_dir / 'js'
        css_dir = www_dir / 'css'

        # Create handler
        app = web.Application()
        aiohttp_jinja2.setup(app,
                             loader=jinja2.FileSystemLoader(str(template_dir.resolve())))
        app.add_routes([
            web.get('/', self._index),
            web.post('/submit', self._submit),
        ])
        app.router.add_static('/js/', str(js_dir.resolve()))
        app.router.add_static('/css/', str(css_dir.resolve()))
        handler = app.make_handler()  # web.AppRunner(app)

        # Create server
        self.logger.info('Creating event loop')
        server = self._loop.create_server(handler, host=host, port=port)
        self.logger.info('Running server in asyncio')
        self._loop.run_until_complete(server)
        self._loop.run_forever()

        self.logger.info('Server shutdown')

    async def _index(self, request):
        fields = dict()
        for k, v in self._fields.items():
            v = v or {}
            fields[k] = {
                'name': k,
                'type': v.get('type', 'text'),
                'placeholder': v.get('placeholder', f'{k} value'),
            }
            print(fields[k])
        context = {
            'fields': fields,
        }
        response = aiohttp_jinja2.render_template('metaform.html',
                                                  request,
                                                  context)
        return response

    async def _submit(self, request: web.Request):
        data = await request.json()
        if '_timestamp' in data:
            return web.Response(text='_timestamp is a reserved metadata',
                                status=400)
        data['_timestamp'] = datetime.datetime.utcnow().isoformat()
        self.logger.info('request: %s', data)
        try:
            self._queue.put(data, False)
        except queue.Full:
            return web.Response(text='Could not handle the metadata changes',
                                status=503)

        return await self._index(request)
