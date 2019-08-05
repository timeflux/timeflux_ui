let io = new IO();

let state = false;
let element = document.body;

function on_start(rate, duration) {
    io.commit('events', {label: 'stim_begins', data: {rate: rate, duration: duration}});
}

function on_tick(time_scheduled, time_called, ellapsed_inter, fps) {
    state = !state;
    color = state ? '#FF0000' : '#00FFFF'; // Additive color mixing
    element.style.backgroundColor = color;
    let ellapsed_intra = performance.now() - time_called;
    io.commit('ticks', {
        time_scheduled: time_scheduled,
        time_called: time_called,
        ellapsed_inter: ellapsed_inter,
        ellapsed_intra: ellapsed_intra,
        fps: fps
    });
}

function on_stop() {
    io.commit('events', {label: 'stim_ends', data: null});
    io.publish('events');
    io.publish('ticks');
    // requestAnimationFrame() is used to avoid race condition
    window.requestAnimationFrame(() => { element.style.backgroundColor = '#FFFFFF'; });

}

stim = new Scheduler(10,5000);
stim.on('start', on_start);
stim.on('tick', on_tick);
stim.on('stop', on_stop);

io.on('connect', () => {
    console.log('connected');
    stim.start();
    // If vsync is correctly aligned, we should see flickering gray at max rate (0).
});

io.on('disconnect', () => { console.log('diconnected') });
io.on('message', (message) => { console.log(message) });
io.on('streams', (streams) => { console.log(streams) });
