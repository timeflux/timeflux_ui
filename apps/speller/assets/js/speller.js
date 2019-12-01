/**
 * @file P300 Speller
 * @author Pierre Clisson <pierre@clisson.net>
 */

'use strict';


/**
 * A simple P300 speller
 *
 * @todo: Configurable random ranges and durations instead of hard-coded values.
 * @see: Riemannian Minimum Distance to Mean Classifier for P300 BCI data: the non-adaptive mode
 *
 * @mixes Dispatcher
 */
class Speller {

    /**
     * @param {Object} [options]
     * @param {string} [options.symbols] - list of characters available for the speller
     * @param {string} [options.targets] - list of characters used for training
     * @param {number} [options.columns] - number of columns in the grid
     * @param {number} [options.groups] - number of groups
     * @param {number} [options.repetitions] - number of rounds in a block
     * @param {HTMLElement} [options.symbol_grid] - grid container DOM node
     * @param {Object} [options.classes]
     * @param {string} [options.classes.symbol] - CSS class prefix used for grid items
     * @param {string} [options.classes.focus] - CSS class to apply on focus
     * @param {string} [options.classes.flash] - CSS class to apply on flash
     * @param {Object} [options.durations]
     * @param {number} [options.durations.baseline_eyes_open] - milliseconds
     * @param {number} [options.durations.baseline_eyes_closed] - milliseconds
     * @param {number} [options.durations.focus] - milliseconds
     * @param {number} [options.durations.inter_block] - milliseconds
     * @param {number} [options.durations.flash] - milliseconds (from exponential distribution)
     * @param {number} [options.durations.flash.expectation] - milliseconds
     * @param {number} [options.durations.flash.min] - milliseconds
     * @param {number} [options.durations.flash.max] - milliseconds
     * @param {number} [options.durations.inter_flash] - milliseconds (from exponential distribution)
     * @param {number} [options.durations.inter_flash.expectation] - milliseconds
     * @param {number} [options.durations.inter_flash.min] - milliseconds
     * @param {number} [options.durations.inter_flash.max] - milliseconds
     */
    constructor(options = {}) {
        let default_options = {
            symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
            targets: 'TRAINING',
            columns: 6,
            groups: 12,
            repetitions: 3,
            symbol_grid: document.getElementById('symbols'),
            classes: {
                symbol: 'symbol',
                focus: 'focus',
                flash: 'flash'
            },
            durations: {
                baseline_eyes_open: 30000,
                baseline_eyes_closed: 30000,
                focus: 500,
                inter_block: 1000,
                flash: {
                    expectation: 80,
                    min: 60,
                    max: 160
                },
                inter_flash: {
                    expectation: 120,
                    min: 80,
                    max: 300
                }
            },

        };
        this.options = merge(default_options, options);
        this.beep = new Audio('assets/wav/beep.wav');
        this.io = new IO();
        this._make_grid();
        this._make_groups();
        this.status = 'ready';
        this.io.on('connect', () => this.io.event(
            'session_begins',
            {
                symbols: this.options.symbols,
                columns: this.options.columns,
                groups: this.groups,
                repetitions: this.options.repetitions
            }
        ));
        window.onbeforeunload = () => {
            this.io.event('session_ends');
        }
        this.scheduler = new Scheduler();
        this.scheduler.start();
    }

    /**
     * Add symbols to the grid
     */
    _make_grid() {
        this.options.symbol_grid.style.gridTemplateColumns = 'repeat(' + this.options.columns + ', 1fr)';
        for (let i in this.options.symbols) {
            let  symbol = document.createElement('div');
            symbol.className = this.options.classes.symbol;
            symbol.id = this.options.classes.symbol + '_' + i;
            symbol.textContent = this.options.symbols[i];
            this.options.symbol_grid.appendChild(symbol);
        }
    }

    /**
     * Create random groups
     */
    _make_groups() {
        this.groups = Array.from({length: this.options.groups}, () => []);
        for (let i in this.options.symbols) {
            try {
                this._assign_groups(i);
            }
            catch(err) {
                this._make_groups();
            }
        }
    }

    /**
     * Assign groups to the given symbol
     */
    _assign_groups(symbol) {
        let max_length = Math.ceil(this.options.symbols.length * 2 / this.options.groups);
        let remaining = this.groups.filter(group => group.length < max_length).length;
        if (remaining < 2) throw False; // Unsolvable
        let groups = [0, 0]; // Each symbol must be in exactly two groups
        while (groups.length !== [...new Set(groups)].length) {
            for (let i = 0; i < groups.length; i++) {
                groups[i] = this._rand_group();
                while (this.groups[groups[i]].length === max_length) {
                    groups[i] = this._rand_group();
                }
            }
        }
        for (let group of groups) {
            this.groups[group].push(symbol);
        }
    }

    /**
     * Get a random group
     */
    _rand_group() {
        return Math.floor(Math.random() * Math.floor(this.options.groups));
    }

    /*
     * Draw a random number from an exponential distribution
     *
     * @see: https://en.wikipedia.org/wiki/Exponential_distribution#Generating_exponential_variates
     *
     * @param {number} [λ] - rate
     * @returns {number}
     */
    _rand_exponential(λ = 1) {
        return -Math.log(Math.random()) / λ;
    }

    /**
     * Draw a constrained random number from an exponential distribution
     */
    _rand_range(expectation, min, max) {
        while (true) {
            let v = this._rand_exponential() * expectation;
            if (v >= min && v <= max) return v;
        }
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

    /**
     * Get the index of a symbol
     */
    _get_symbol(symbol) {
        return Object.keys(this.options.symbols).find(key => this.options.symbols[key] === symbol);
    }

    /**
     * Briefly focus on a symbol
     *
     * @param {int} symbol
     */
    async focus(symbol, duration) {
        let element = document.getElementById('symbol_' + symbol);
        element.classList.add(this.options.classes.focus);
        await sleep(duration);
        element.classList.remove(this.options.classes.focus);
    }

    /**
     * Flash a group
     *
     * @param {int} group
     */
    async flash(group, duration) {
        let elements = [];
        await this.scheduler.asap(() => {
            for (let symbol of this.groups[group]) {
                let element = document.getElementById('symbol_' + symbol);
                elements.push(element);
                element.classList.add(this.options.classes.flash);
            }
            let includes_target = this.status == 'testing' ? null : this.groups[group].includes(this.target);
            this.io.event('flash_begins', { group: group, includes_target: includes_target });
        });
        await sleep(duration);
        for (let element of elements) {
            element.classList.remove(this.options.classes.flash);
        }
        this.io.event('flash_ends');
    }

    /**
     * Randomize group order and flash each group
     */
    async round() {
        // Randomize group order
        let groups = [...Array(this.options.groups).keys()]
        this._shuffle(groups);
        // Flash and wait
        this.io.event('round_begins');
        for (let group of groups) {
            await this.flash(group, this._rand_range(
                this.options.durations.flash.expectation,
                this.options.durations.flash.min,
                this.options.durations.flash.max
            ));
            await sleep(this._rand_range(
                this.options.durations.inter_flash.expectation,
                this.options.durations.inter_flash.min,
                this.options.durations.inter_flash.max
            ));
        }
        this.io.event('round_ends');
    }

    /**
     * Repeat round
     *
     * @param {number} repetitions
     */
    async block(repetitions) {
        for (let i = 0; i < repetitions; i++) {
            await this.round();
        }
    }

    /**
     * Start training
     *
     * @param {string} [targets]
     */
    async train(targets) {
        if (targets === undefined) targets = this.options.targets;
        this.io.event('calibration_begins');
        this.status = 'calibrating';
        targets = targets.toUpperCase();
        this.beep.play();
        this.trigger('baseline-eyes-open_begins');
        this.io.event('baseline-eyes-open_begins');
        await sleep(this.options.durations.baseline_eyes_open);
        this.io.event('baseline-eyes-open_ends');
        this.beep.play();
        this.trigger('baseline-eyes-closed_begins');
        this.io.event('baseline-eyes-closed_begins');
        await sleep(this.options.durations.baseline_eyes_closed);
        this.io.event('baseline-eyes-closed_ends');
        this.io.event('training_begins', { targets: targets });
        for (let target of targets) {
            this.target = this._get_symbol(target);
            this.beep.play();
            this.trigger('focus_begins', target);
            this.io.event('focus_begins', { target: this.target });
            await this.focus(this.target, this.options.durations.focus);
            this.io.event('focus_ends');
            await sleep(this.options.durations.inter_block);
            this.io.event('block_begins', { target: this.target });
            await this.block(this.options.repetitions);
            this.io.event('block_ends');
        }
        this.target = null;
        this.trigger('training_ends');
        this.io.event('training_ends');
        this.status = 'idle';
        this.io.event('calibration_ends');
    }

    /**
     * Start testing
     */
    async test() {
        this.io.event('testing_begins');
        this.status = 'testing';
        while (this.status == 'testing') {
            this.beep.play();
            await sleep(this.options.durations.inter_block);
            this.io.event('block_begins', { target: null });
            await this.block(this.options.repetitions);
            this.io.event('block_ends');
        }
        this.io.event('testing_ends');
    }

    /**
     * Finish block and stop testing
     */
    stop() {
        if (this.status == 'testing') this.status = 'idle';
    }

}


Object.assign(Speller.prototype, Dispatcher);