'use strict';

let io = new IO();

load_settings().then(settings => {

    // Handle meta and events
    // Metadata is sent to the special '_' stream
    // Events are sent to the 'events' stream
    // TODO: handle missing fields or events in settings
    // TODO: form validation and prevent submit if invalid
    let app = new Vue({
        el: '#app',
        data: {
            metaButtonDisabled: false,
            metaButtonClass: 'is-info',
            eventButtonClass: 'is-info',
            metaData: {},
            eventData: {},
            fields: settings.operator.fields,
            events: settings.operator.events,
            received: ''
        },
        created() {
            io.subscribe('events');
            io.on('events', (data) => {
                for (let timestamp in data) {
                    let time = new Date(parseFloat(timestamp));
                    let h = `${time.getHours()}`.padStart(2, '0');
                    let m = `${time.getMinutes()}`.padStart(2, '0');
                    let s = `${time.getSeconds()}`.padStart(2, '0');
                    let ms = `${time.getMilliseconds()}`
                    let line = h + ':' + m + ':' + s + '.' + ms;
                    line += ' - ' + data[timestamp]['label'] + ' - ' + data[timestamp]['data'];
                    line += '\n';
                    this.received = line + this.received;
                }
            })
        },
        methods: {
            send_meta() {
                io.meta(this.metaData);
                this.metaButtonClass = 'is-success';
                this.metaButtonDisabled = true;
            },
            send_event() {
                if (this.eventData.label) {
                    io.event(this.eventData.label, this.eventData.data);
                    this.eventData = {};
                }
            }
        }
    });

});