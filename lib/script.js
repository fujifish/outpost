var child = require('child_process');
var path = require('path');
var fs = require('fs');
var util = require('util');
var crypto = require('crypto');

process.on('uncaughtException', function(err) {
  outpost.fail('script exception: ' + err.stack);
});

/**
 * Script runner, providing a global object for use by outpost scripts
 */

var script = process.env['outpostScript'];
if (!script) {
  outpost.fail('script not specified');
  return;
}

var scriptType = process.env['outpostScriptType'];
if (!scriptType) {
  outpost.fail('script type not specified');
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
   * Proxy information or null if there is not proxy configured. This is derived from the outpost configuration:
   *  - url - proxy url of the form http[s]://[user:password@]hostname[:port]
   *  - authType - either 'basic' or 'ntlm'
   *  - ntlmDomain - the NTLM domain if authentication is NTLM
   */
  proxy: (function() {
    if (config.proxy) {
      return {
        url: config.proxy,
        authType: config.proxyAuthType,
        ntlmDomain: config.proxyNTLMDomain
      };
    }
    return null;
  })(),

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
    process.send({result: 'error', details: message});
    setImmediate(function() {
      process.exit(0);
    });
  },

  /**
   * Start a process and monitor it
   * @param info process information:
   *  - name - [required] the unique name of this monitored process used to identify this process in all later commands
   *  - cmd - the executable to execute. default is the node process that also started outpost
   *  - args - array of command line options to pass to the started process
   *  - cwd - the cwd for the process to monitor. default is the current module directory
   *  - env - a hash of environment variables for the launched process. defaults to the outpost environment variables
   *  - uid - user id to use for the launched process. defaults to the outpost user id
   *  - gid - group id to use for the launched process. defaults to the outpost group id
   *  - timeout - time in seconds to wait for the process to actually start. defaults to 10 seconds
   *  - logFile - the log file for the the process stdout and stderr. defaults to the logsDir setting as specified in the outpost configuration
   *  - pidFile - a custom pid file that stores the process id to monitor. defaults to the process id of the process that is launched
   * @param cb
   */
  monitor: function(info, cb) {
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    info.cwd = path.resolve(process.cwd(), info.cwd || '');
    process.send({monitor: info, cbid: cbid});
  },

  /**
   * Start a process and monitor that it is running
   * @param info
   *  - name - [required] name of the process to unmonitor
   *  - timeout - time in seconds to wait for the process to actually stop. defaults to 10 seconds
   * @param cb
   */
  unmonitor: function(info, cb) {
    if (!info.name) {
      cb && cb('must provide process name');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({unmonitor: info, cbid: cbid});
  },

  /**
   * Run a script of a submodule. the script that will run is the of the same type as the current script (install, configure, etc.)
   * @param module the module name whose script is to be run
   * @param config the configuration to pass to the executed script
   * @param cb invoked when the script is done. receives err if the script failed.
   */
  script: function(module, config, cb) {
    if (!module) {
      cb && cb('must provide module name');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({script: {module: module, config: config || {}}, cbid: cbid});
  },

  /**
   * Render a template. Template are processed as "mustache" templates (http://mustache.github.io/mustache.5.html)
   * @param template input template. may be a file name or the complete template string
   * @param context context for rendering the template
   * @param output output file. if provided, the result will also be saved to the specified file
   * @param cb receives err and the rendering result
   */
  template: function(template, context, output, cb) {
    if (!template) {
      cb && cb('must provide template');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    if (typeof output === 'function') {
      cb = output;
      output = null;
    }
    callbacks[cbid] = cb;
    process.send({template: template, context: context || {}, output: output, cbid: cbid});
  },

  /**
   * Execute a command line. stderr is automatically redirected to stdout so no need to specify that on the command line.
   * @param cmd the command line to execute
   * @param options (optional) options for the command:
   *  - cwd - the working directory to execute the command from
   *  - timeout - time to wait (in seconds) for the command to complete before it is forcefully terminated
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
