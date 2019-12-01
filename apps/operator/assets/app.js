'use strict';

let io = new IO();

load_settings().then(settings => {

    // Handle meta and events
    // Metadata is sent to the special '_' stream
    // Events are sent to the 'events' stream
    // TODO: clear forms after submit
    // TODO: handle missing fields or events in settings
    // TODO: form validation and prevent submit if invalid
    // TODO: provide a notification when sent
    let app = new Vue({
        el: '#app',
        data: {
            metaData: {},
            eventData: {},
            fields: settings.fields,
            events: settings.events
        },
        methods: {
            send_meta: function() {
                io.meta(this.metaData);
            },
            send_event: function() {
                io.event(this.eventData.label, this.eventData.data);
            }
        }
    });

});