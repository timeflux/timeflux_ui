'use strict';

let io = new IO();

load_settings().then(settings => {

    let container = document.getElementById('container');
    let circle = document.getElementById('circle');
    let max = 0;
    resize();
    window.onresize = resize;

    io.subscribe('level');
    io.on('level', (data) => {
        let row = data[Object.keys(data)[Object.keys(data).length - 1]]; // Last row
        let column = Object.keys(row)[0]; // First column
        let value = row[column]; // Value between 0 and 1
        console.log(value); // For debugging purposes
        let px = value * max + 'px'; // Transform to pixels
        circle.style.width = px; // Set the width
        circle.style.height = px; // Set the height
    })

    function resize() {
        let width = container.clientWidth;
        let height = container.clientHeight;
        max = width < height ? width : height;
    }

});