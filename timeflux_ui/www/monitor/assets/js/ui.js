var options = {
  minValue: undefined,
  maxValue: undefined,
  lineWidth: 1,
  millisPerPixel: 10,
  interpolation: 'linear',
  events: [ 'start', 'stop', 'pause', 'resume', 'observation']
};

var charts = {};
var series = {};

var io = new IO();


var Chart = Vue.extend({
  data: function() {
    return {
      'title': '',
      'ids': [],
      'height': 0,
      'toggle': false,
      'stream': '',
      'channels': []
  }},
  template: '#chart-template',
  methods: {

    remove_chart: function() {
      for (id of this.ids) {
        charts[id].stop();
        delete charts[id];
      }
      for (channel of this.channels) {
        series[this.stream][channel]['charts']--;
        if (series[this.stream][channel]['charts'] === 0) {
          delete series[this.stream][channel];
        }
      }
      if (Object.keys(series[this.stream]).length === 0) {
        delete series[this.stream];
        io.unsubscribe(this.stream);
      }
      this.$el.parentNode.removeChild(this.$el);
      this.$destroy();
    }

  }
});

var app = new Vue({
  el: '#app',
  data: {
    connected: false,
    selected_stream: undefined,
    selected_channel: undefined,
    selected_event: undefined,
    event_data: undefined,
    events: options.events,
    streams: {}
  },
  methods: {

    add_chart: function() {

      // Get stream and channels
      stream = this.selected_stream;
      combine = this.selected_channel == 'all_combine' ? true : false;
      append = this.selected_channel == 'all_append' ? true : false;
      if (combine || append) {
        channels = this.streams[stream];
      } else {
        channels = [this.selected_channel];
      }

      // Create time series if necessary
      if (series[stream] === undefined) {
        series[stream] = {};
      }
      for (channel of channels) {
        if (series[stream][channel] === undefined) {
          series[stream][channel] = {
            'instance': new TimeSeries(),
            'charts': 0,
          };
        }
        series[stream][channel]['charts']++;
      }

      // Subscribe to stream
      io.subscribe(stream);

      // Unique ID for this chart
      id = Math.random().toString(36).substr(2, 9) + '_' + stream;

      // Append chart component
      var chart = new Chart();
      chart.stream = stream;
      chart.channels = channels;
      chart.title = stream;
      if (append) {
        chart.height = 50;
        for (channel of channels) {
          chart.ids.push(id + '_' + channel);
        }
      } else {
        chart.height = 200;
        chart.ids.push(id);
      }
      chart.$mount();
      this.$refs.main.appendChild(chart.$el)

      // Create charts and bind series
      if (append) {
        for (channel of channels) {
          create_chart(id + '_' + channel, stream, [channel], 'light');
        }
      } else {
        create_chart(id, stream, channels, 'light');
      }
    },

    send_event: function() {
      if (this.selected_event) {
        io.event(this.selected_event, this.event_data);
      }

    }

  }
})


function create_chart(id, stream, channels, theme) {
  themes = {
    'dark': {
      'background': 'rgb(54, 54, 54)',
      'foreground': 'white',
      'grid': '#dbdbdb'
    },
    'light': {
      'background': 'white',
      'foreground': 'black',
      'grid': '#dbdbdb'
    }
  }
  charts[id] = new SmoothieChart({
    minValue: options.minValue,
    maxValue: options.maxValue,
    maxValueScale: 1,
    minValueScale: 1,
    grid: {
      strokeStyle: themes[theme]['grid'],
      fillStyle: themes[theme]['background'],
      sharpLines: true,
      borderVisible: false
    },
    responsive: true,
    millisPerPixel: options.millisPerPixel,
    labels: {
      fillStyle: themes[theme].foreground
    },
    title: {
      fillStyle: themes[theme].foreground,
      text: channels.length == 1 ? channels[0] : '',
      fontSize: 21,
      verticalAlign: 'top'
    },
    interpolation: options.interpolation
  });
  charts[id].streamTo(document.getElementById(id), 1000);
  for (channel of channels) {
    charts[id].addTimeSeries(series[stream][channel]['instance'], { strokeStyle: themes[theme]['foreground'], lineWidth: options.lineWidth });
  }
}

function update_series(payload) {
  if (series[payload.name] !== undefined) {
    for (const timestamp of Object.keys(payload.data)) {
      for (const channel of Object.keys(payload.data[timestamp])) {
        if (series[payload.name][channel] !== undefined) {
          series[payload.name][channel]['instance'].append(timestamp, payload.data[timestamp][channel]);
        }
      }
    }
  }
}

io.on('connect', function() {
  app.connected = true;
});

io.on('disconnect', function() {
  app.connected = false;
});

io.on('stream', function(payload){
  update_series(payload);
});

io.on('streams', function(payload) {
  app.streams = payload;
});


load_settings().then(settings => {
  options = merge(options, settings.monitor);
  if (settings.monitor && settings.monitor.events) {
    options.events = settings.monitor.events;
    app.events = options.events;
  }
});