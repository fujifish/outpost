var child = require('child_process');
var fs = require('fs');
var util = require('util');
var crypto = require('crypto');

/**
 * Script runner, providing a global object for use by outpost scripts
 */

var script = process.env['outpostScript'];
if (!script) {
  outpost.fail('script not specified');
  return;
}

// the outpost main config
var config = JSON.parse(process.env['outpostConfig'] || '{}');

var callbacks = {};

// the process will receive messages that are callbacks
process.on('message', function(msg) {
  if (msg.cbid && callbacks[msg.cbid]) {
    callbacks[msg.cbid].apply(null, msg.args);
  }
});

/**
 * global outpost object with utility functions for use in scripts
 */
outpost = {

  /**
   * script configuration
   */
  config: JSON.parse(process.env['outpostScriptConfig'] || '{}'),

  /**
   * Log a message to the console
   * @param message
   */
  log: function(message) {
    process.send({log: message});
  },

  /**
   * Indicate progress. if no progress is received at least once every 60 seconds, the script is terminated
   */
  progress: function() {
    process.send({progress: true});
  },

  /**
   * The script is done executing successfully.
   */
  done: function() {
    process.send({result: 'success'});
    setImmediate(function() {
      process.exit(0);
    });
  },

  /**
   * The script is done executing with an error. Terminates the script immediately.
   * @param message the error message
   */
  fail: function(message) {
    process.send({error: message});
    setImmediate(function() {
      process.exit(0);
    });
  },

  /**
   * Start a process and monitor it
   * @param info
   * @param cb
   */
  monitor: function(info, cb) {
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({monitor: info, cbid: cbid});
  },

  /**
   * Start a process and monitor that it is running
   * @param info must contain process name or pid to unmonitor
   * @param cb
   */
  unmonitor: function(info, cb) {
    if (!info.name && !info.pid) {
      cb && cb('must provide name or pid');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({unmonitor: info, cbid: cbid});
  },

  /**
   * Execute a command line. stderr is automatically redirected to stdout so no need to specify that on the command line.
   * @param cmd the command line to execute
   * @param options (optional) options for the command:
   *  - cwd - the working directory to execute the command from
   *  - timeout - time to wait (in seconds) for the command to complete before it is forcefully terminated with SIGTERM
   * @param cb completion callback:
   *  - code - the exit code of the command
   *  - signal - if the command exited with an error because of timeout or some other signal
   *  - output - the console output (stderr and stdout merged)
   * @returns {*}
   */
  exec: function(cmd, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    cmd = cmd + ' 2>&1';
    child.exec(
      cmd,
      { encoding: 'utf8',
        timeout: (options.timeout || 0) * 1000,
        maxBuffer: 1000*1024,
        killSignal: 'SIGTERM',
        cwd: options.cwd,
        env: null },
      function(error, stdout) {
        var code = error ? error.code : 0;
        var signal = error ? error.signal : null;
        cb(code, signal, stdout);
      }
    )
  }
};

// invoke the script. the global object 'outpost' is available to the script
require(script);
