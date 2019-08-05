'use strict';

let embed = document.getElementById('eeg_10-20');
let svg = false;
let colors = ['red', 'orange', 'green'];
let io = new IO();

embed.addEventListener('load', () => {
    svg = embed.getSVGDocument();
});

io.on('connect', () => {
    console.log('connected');
    io.subscribe('sqi');
});

io.on('sqi', (data) => {
    // Get last row of data
    let keys = Object.keys(data);
    let row = data[keys[keys.length - 1]];
    // Set color
    for (let key in row) {
        let fill = colors[row[key]];
        let element = svg.getElementById(key);
        if (element) {
            element.setAttribute('fill', fill);
            element.setAttribute('fill-opacity', '1');
        } else {
            console.warn('Invalid key: ' + key);
        }
    }
});