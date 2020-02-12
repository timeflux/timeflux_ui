'use strict';

class Flicker {

    /**
     * Initialize the Oddball experiment
     *
     * @param {IO} io - Timeflux IO instance
     * @param {Object|boolean} [grid] - if false, the grid will not be built
     * @param {HTMLElement} [grid.container] - grid container
     * @param {number} [grid.rows] - number of rows in the grid
     * @param {number} [grid.columns] - number of columns in the grid
     */
    constructor(io, options = {}) {

        this.io = io;

        // Overwrite default options with given options
        let default_options = {
            'grid': {
                'container': document.body,
                'rows': 3,
                'columns': 3
            },
            calibration: {
                'baseline_duration': 0,
                'focus_duration': 7000,
                'rounds': 1
            },
            'color_on': 'black',
            'color_off': 'white',
            'refresh_rate': 60,
            'class': 'cell',
            'highlight_duration': 1500,
            'targets': {
                'cell_0_0': 6.66,
                'cell_0_2': 12,
                'cell_1_1': 0,
                'cell_2_0': 20,
                'cell_2_2': 30
            },
            'paradigm': 'ssvep'
        };
        if ('targets' in options) default_options.targets = {};
        this.options = merge(default_options, options);

        // Dynamically assign a mixin
        let paradigms = {
            'noise_tagging': NoiseTagging,
            'ssvep': SSVEP
        };
        Object.assign(Object.getPrototypeOf(this), paradigms[this.options.paradigm]);

        // Build grid
        this._grid();

        // Initialize
        this._init();

        // Get HTML elements for faster access
        this._cells = {};
        for (let id in this.options.targets) {
            this._cells[id] = document.getElementById(id);
        }
    }

    /**
     * Calibration
     */
    async calibrate() {
        this.io.event('calibration_starts');
        this.io.event('calibration-baseline_starts');
        await sleep(this.options.calibration.baseline_duration);
        this.io.event('calibration-baseline_stops');
        let ids = Object.keys(this._cells);
        for (let i = 0; i < this.options.calibration.rounds; i++) {
            this._shuffle(ids);
            for (const id of ids) {
                let meta = { 'id': id, 'frequency': this.options.targets[id] };
                await this.highlight(id);
                this.io.event('calibration-focus_starts', meta);
                await sleep(this.options.calibration.focus_duration);
                this.io.event('calibration-focus_stops', meta);
            }
        }
        this.io.event('calibration_stops');
        this.stop();
    }

    /**
     * Highlight a target
     */
    async highlight(id) {
        this.stop();
        this._cells[id].classList.toggle('highlight');
        await sleep(this.options.highlight_duration);
        this._cells[id].classList.toggle('highlight');
        this.start();
    }


    /**
     * Build the grid
     */
    _grid() {
        if (this.options.grid === false) return;
        let grid = document.createElement('table');
        for (let i = 0; i < this.options.grid.rows; i++) {
            let row = document.createElement('tr');
            for (let j = 0; j < this.options.grid.columns; j++) {
                let cell = document.createElement('td');
                let id = 'cell_' + i + '_' + j;
                cell.classList.add(this.options.class);
                cell.setAttribute('id', id);
                //cell.innerHTML = id;
                row.appendChild(cell);
            }
            grid.appendChild(row);
        }
        this.options.grid.container.appendChild(grid);
    }

    /**
     * Shuffle an array
     *
     * This is done in-place. Make a copy first with .slice(0) if you don't want to
     * modify the original array.
     *
     * @param {array} array
     *
     * @see:https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
     */
    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

}


/**
 * SSVEP mixin
 *
 * @mixin
 */
let SSVEP = {

    _init() {
        this.schedulers = []
        for (let id in this.options.targets) {
            if (this.options.targets[id] > 0) {
                this.schedulers[id] = new Scheduler(this.options.targets[id] * 2);
                this.schedulers[id].on('tick', () => { this.on_tick(id) });
            }
        }
    },

    start() {
        for (let id in this.schedulers) {
            this.schedulers[id].start();
        }
    },

    stop() {
        for (let id in this.schedulers) {
            this.schedulers[id].stop();
            this._cells[id].style.backgroundColor = '';
        }
    },

    on_tick(id) {
        let color = this.options.color_on;
        if (this._cells[id].style.backgroundColor == this.options.color_on) {
            color = this.options.color_off;
        }
        this._cells[id].style.backgroundColor = color;
    }

}


/**
 * NoiseTagging mixin
 *
 * @mixin
 */
let NoiseTagging = {

    _init() {
        this.elements = document.getElementsByClassName(this.options.class);
        this.interval = 1000 / this.options.refresh_rate;
        this.max = states[0].length - 1;
        this.scheduler = new Scheduler();
        this.scheduler.on('tick', this.on_tick.bind(this));
    },

    start() {
        this.frame = 0;
        this.scheduler.start();
    },

    stop() {
        this.scheduler.stop();
        for (const e of this.elements) e.style.backgroundColor = '';
    },

    on_tick(scheduled, called, ellapsed, fps) {
        this.frame += Math.round(ellapsed / this.interval);
        if (this.frame > this.max) {
            this.frame = this.frame - this.max - 1;
        }
        for (let i = 0; i < this.elements.length; i++) {
            let color = states[i][this.frame] === 0 ? this.options.color_on : this.options.color_off;
            this.elements[i].style.backgroundColor = color;
        }
    }

}
