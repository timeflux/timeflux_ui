'use strict';

let flicker = null;
let io = new IO();
let options = {};
const calibrate_button = document.getElementById('calibrate');
const start_button = document.getElementById('start');

load_settings().then(settings => {
    options = settings.flicker;
    calibrate_button.addEventListener('click', calibrate);
    start_button.addEventListener('click', classify);
});

async function calibrate() {
    document.body.classList.toggle('quiet');
    calibrate_button.classList.toggle('hidden');
    flicker = new Flicker(io, options);
    await flicker.calibrate();
    document.body.classList.toggle('quiet');
    start_button.classList.toggle('hidden');
}

async function classify() {
    document.body.classList.toggle('quiet');
    start_button.classList.toggle('hidden');
    flicker.start();
}