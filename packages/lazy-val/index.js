'use strict';

// Original FDO implementation of the small `Lazy` surface used by electron-updater.
class Lazy {
  constructor(creator) {
    this._creator = creator;
    this._value = undefined;
    this._started = false;
  }

  get hasValue() {
    return this._started;
  }

  get value() {
    if (!this._started) {
      this._started = true;
      this._value = Promise.resolve().then(() => this._creator());
    }
    return this._value;
  }

  set value(value) {
    this._started = true;
    this._value = Promise.resolve(value);
  }
}

exports.Lazy = Lazy;
