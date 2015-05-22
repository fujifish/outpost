
var fs = require('fs');
var path = require('path');

function pad(str) {
  str = '  ' + str;
  while (str.length < 16) str += ' ';
  return str;
}

var baseCommands = {
  install: {
    desc: 'install a module',
    usage: '<module> [options]',
    help: 'Installing a module requires specifying a url or module name',
    example: 'outpost install http://my.registry/path/to/module.tar.gz',
    process: function(argv) {
      if (argv._.length === 0) {
        usage(null, 'install');
      }

      return {
        type: 'install',
        url: argv._[0]
      }
    }
  },
  configure: {
    desc: 'configure a module',
    help: '',
    example: 'outpost configure mymodule@1.0.2 --config /path/to/config/file'
  },
  start: {
    desc: 'start a module',
    help: '',
    example: 'outpost start mymodule@1.0.2'
  },
  stop: {
    desc: 'stop a module',
    help: '',
    example: 'outpost stop mymodule@1.0.2'
  },
  sync: {
    desc: 'sync outpost with homebase',
    help: '',
    example: 'outpost stop mymodule@1.0.2'
  },
  agent: {
    desc: 'control the outpost agent',
    usage: '<command> [options]',
    help: 'Please specify a command for agent',
    example: 'outpost agent start',
    commands: {
      start: {
        desc: 'start the agent'
      },
      stop: {
        desc: 'stop the agent'
      }
    },
    process: function(argv) {
      if (argv._.length === 0) {
        usage(null, 'agent');
      }

      var command = argv._.shift();
      if (!baseCommands['agent'].commands[command]) {
        usage('\'' + command + '\' is not a valid command for agent', 'agent');
      }

      return {
        type: 'agent',
        command: command
      }
    }
  }
};

function usage(message, commandName) {
  var usageMessage = 'Usage: outpost <command> [options]';
  var commands = baseCommands;
  var command = commands[commandName];
  if (command) {
    usageMessage = 'Usage: outpost ' + commandName + ' ' + command.usage;
    commands = command.commands || [];
  }

  console.log(usageMessage + '\n');

  if (commands.length > 0) {
    console.log('Commands:');
    Object.keys(commands).forEach(function(c) {
      var command = pad(c);
      console.log(command + commands[c].desc);
    });
    console.log('');
  }
  console.log(message || (command && command.help) || 'See "outpost help <command>" for more information on a specific command.');
  process.exit(1);
}


function processArgs() {
  var argv = require('minimist')(process.argv.slice(2));

  if (argv._.length === 0) {

    // check if we have the --agent option present
    if (argv.daemon) {
      if (!argv.opconfig) {
        console.log('Usage: outpost --daemon --opconfig <outpost config file or string> \n');
        console.log('Daemon mode requires specifying a config file or the complete configuration string');
        process.exit(1);
      }
      return {
        type: 'daemon',
        opConfig: argv.opconfig
      }
    }

    usage();
  }

  // remove the command
  var command = argv.command = argv._.shift();
  if (!baseCommands[command]) {
    usage('\'' + command + '\' is not a valid outpost command');
  }

  var com = baseCommands[command].process(argv);
  com.opConfig = argv.opconfig;
  return com;
}

exports.process = module.exports.process = processArgs;