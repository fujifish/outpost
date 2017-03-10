<div align="center"><img src="https://capriza.github.io/images/logos/logos-outpost.svg" height="128" /></div>

Outpost
===

Outpost is a software management and monitoring agent. Outpost configures, starts and continuously monitors 
running processes to make sure they stay running. 

Outpost is built from the ground up to be very secure:

* Does not run as root
* Only privately signed modules can be installed
* No inbound connection
* No arbitrary commands, only specific lifecycle commands (install, configure, start, etc.)

[Fortitude](https://github.com/capriza/fortitude) is the outpost server, providing visibility into running outpost 
agents and the state of modules that every outpost agent is managing.

## Why?

This whole thing may ring a bell to those familiar with
[infrastructure automation and configuration management](https://en.wikipedia.org/wiki/Comparison_of_open-source_configuration_management_software)"
tools such as Puppet, Chef, SaltStack and Ansible.

Outpost is different. It is not intended for automating the configuration and management of *infrastructure*.
Outpost is used to automate the lifecycle of *application level* software. The primary use case is for managing
software that's installed outside of your own infrastructure, most notably on a customers infrastructure. This software
may still connect to your cloud service, but installing it on an infrastructure that's not your own creates
several problems:

* Visibility - it's difficult to track what's installed, where and for whom
* Supportability - it's difficult to know when something goes wrong, or what went wrong
* Maintainability - it's difficult to perform maintenance

### So Why Not Use Puppet/Chef/SaltStack/Ansible?

Because these tools assume you have complete control over the infrastructure. If you can access the machine and
install the tool agent on it then it's yours for the taking. You can do whatever you want with it.
This is very much _not_ the case when dealing with infrastructure that's not yours.

Security and authorization is a very big issue when installing on a customers infrastructure; 
an outpost agent must authenticate and authorize with fortitude to get things done.

# Quick Start Example

#### 1. Install Outpost

```bash
# install outpost
> git clone https://github.com/capriza/outpost
> cd outpost
> npm install
```

#### 2. Init Agent

```bash
> bin/outpost agent init
-----------------------------------------
Agent name:  my agent
Root folder for outpost files: /tmp
Registry url:  http://localhost:7878
Fortitude url:
Proxy url:
Internal CLI server port:  (7608)
-----------------------------------------
This is the configuration that will be saved:
{
  "name": "my agent",
  "root": "/tmp",
  "registry": "http://localhost:7878",
  "cliport": "7608",
  "id": "0d75420ca81f"
}
Save configuration? (y/n):  y
-----------------------------------------
```

#### 3. Start Agent

```bash
> bin/outpost agent start
```

#### 4. Start Sample Registry Server (this step is not needed for production)

Start a local running [http server](https://github.com/indexzero/http-server)
for serving trh sample module. It's only here for the sake of this example.

```bash
> node_modules/.bin/http-server ./examples -p 7878 &
```

#### 5. Pack MyServer Sample Module

MyServer is a sample module residing in the `examples` directory.

```bash
> bin/outpost module pack --dir examples/my-server/my-server-1.0.0/module --out examples/my-server/my-server-1.0.0
```

#### 6. Install MyServer Module

```bash
> bin/outpost install my-server@1.0.0
```

#### 7. Configure MyServer Module

```bash
> bin/outpost configure my-server --config '{"port": 8989}'
```

#### 8. Start MyServer Module

```bash
> bin/outpost start my-server
```

Open up your browser at `http://localhost:8989`, you should get a `cool` message.

# Outpost Agent

The outpost agent is responsible for performing the following:

* Perform [commands](#agent-commands) received from the command line
* Periodically [synchronize](#agent-synchronize) with the fortitude server
* Monitor module processes and relaunch failed processes (similar to what [forever](https://github.com/foreverjs/forever) does)

### Agent Installation

Installing for testing and development is different than distributing to customers.

#### Testing and Development Environments

Outpost is a plain old node module, so installing it is done like any other node module:

```
node install outpost
```

#### Production Environments and Distribution

When installing outpost on a customer infrastructure, there are some things we have to consider. For instance,
we can't assume that the customer has network access to npm, or that node is even installed on the machine.

For that reason, it is usually necessary to pack outpost with the node executable into another distributable
form such as a tar file. Place the node executable in the root folder of the outpost agent installation.

```
<install dir>
 |- bin
 |- lib
 |- package.json
 '- node

```

In addition, you'd probably want to add an upstart or init script for starting outpost on machine start up, but this
is out of scope for this documentation.

### Agent Configuration

Outpost configuration is maintained in a file named `opconfig.json`.
Outpost locates this file by traversing the directories upwards from the `bin` directory
until it finds the file, so placing it in the parent directory of the outpost installation is the
preferred location.

#### Configuration Fields

* `name` - Agent name - the display name this agent will have in fortitude. It's just for display purposes.
* `root` - Root folder - this is the directory that will hold the outpost data files. This should be *outside* the
outpost installation directory
* `registry` - Registry url - the url for the modules registry. Outpost downloads modules from this url when installing a module
* `sigPubKey` - Module signature verification public key (33 bytes as a HEX string)
* `fortitude` - Fortitude url - this is the fortitude server url. Leave blank if outpost should be in standalone mode
* `auth` - Fortitude authentication key - authentication key to identify outpost with fortitude. This would normally be different
between customers
* `syncFrequency` - Fortitude sync frequency - how often outpost should synchronize with fortitude (in seconds).
0 disables synchronization completely.
* `proxy` - Proxy url - if outpost should go through a proxy for network access
* `cliport` - Internal CLI port - the cli port outpost opens to allow control through the command line. No need to change the
default unless there is a conflict with a different server running on the same machine.
* `id` - the unique identity of this agent

#### Interactive Configuration

It's possible to interactively configure outpost by running:

```
bin/outpost agent init
```

This will launch an interactive series of questions to provide configuration parameters.

After all fields have been filled, selecting 'yes' to save the configuration will create an `opconfig.json`
file in the current directory. To save the opconfig.json file elsewhere, add the `--output <location>` flag
to the agent init command.

It's also possible to provide default values by specifying the configuration value on the command line:

```
bin/outpost agent init --name "Company X" --auth "very_secret_key_for_company_x"
```

### Agent Start

To start outpost, run:

```
bin/outpost agent start
```

This will launch the outpost agent in daemon mode.

### Agent Stop

To start outpost, run:

```
bin/outpost agent stop
```

This will stop the outpost agent.

## Agent Commands

Outpost supports running several commands to control modules.

* [sync](#agent-synchronize) - synchronize now with the fortitude server
* [apply state](#apply-state) - change the whole state of installed modules
* [install module](#install-phase) - install a single module
* [configure module](#configure-phase) - configure a single module
* [start module](#start-phase) - start a single module
* [stop module](#stop-phase) - stop a single module
* [uninstall module](#uninstall-phase) - uninstall a single module

### Agent Synchronize

Outpost synchronizes with the fortitude server periodically by sending it latest status information and retrieving
a new state to apply. The `syncFrequency` configuration field specifies how often outpost will sync with fortitude.

When synchronizing with fortitude, outpost first sends the following information:

* general information about the agent (platform, agent version, node version, etc.)
* currently installed modules, configuration and running state

If necessary, outpost will receive a new state to apply. After changes are made, the result is sent back to fortitude
to presented in the UI.

Fortitude supports sending the following commands to an outpost agent:

* [Apply State](#apply-state) - change the state of modules
* [Agent Update](#agent-update) - update the agent to a newer version

##### Command Line Synchronize

```
bin/outpost sync
```

##### Apply State

Instead of managing modules separately, it's possible to specify a desired state to reach and outpost will perform all
the necessary steps automatically. This means it will download, install, configure, start, stop and uninstall
modules in the correct sequence until the desired state is reached.

If during the application of the new state an error occurs then outpost will automatically rollback to the previous state
and report the error.

##### Command Line Apply State

This command is rarely used directly; it's mainly invoked from the fortitude server to apply a new desired state.

```
bin/outpost state apply --state <new-state>
```

The `new-state` can be a file path or a complete parseable JSON string.

##### Agent Update

Outpost agent is capable of self-updating. Supporting outpost agent self-update requires that the outpost agent be
installed in a directory named `outpost-current`, for example `/opt/outpost/outpost-current`.

The new outpost version is downloaded from the same registry as all other modules following the same semantics.
The new version is unpacked into a sibling directory of the `outpost-current` directory and then the directory names are
switched.

```
bin/outpost agent update --version <new-version>
```

Place the configuration file in the parent directory of `outpost-current` so that the updated version of outpost will
locate it as well. See [Agent Configuration](#agent-configuration) for details of the configuration file.

```
-<parent dir>
  |-outpost-current
  |  |- bin
  |  |- lib
  |  |- package.json
  |  '- node
  |-outpost-0.1.9
  |  '- ...
  '-opconfig.json

```

# Modules

An outpost module is a container of executables, files and control scripts. The control scripts are used
by outpost to manage the lifecycle of a module.

The identity of a module consists of a name and a version, and the combination of the two uniquely identify the module.

The full name of a module is unique, and has the form `<name>@<version>`.

### Module Anatomy

A module is a tar.gz file with a unique identity.

The complete name of the module binary is `<name>-<version>[-<platform>].tar.gz`.
`platform` is optional, and it distinguishes between different module distribution per platform.
Supported platforms are `linux`, `darwin` and `win32`.

A module must contain a `module.json` file in it's root, and it contains definitions about the module:

* `name` [required] - the module name
* `version` [required] - the module version
* `scripts` [optional] - a list of lifecycle control scripts
* `submodules` [optional] - an array of modules that this modules depends on
* `schema` [optional] - a JSON schema describing the input fields that fortitude should display for configuring this module. This
is never required, it simply helps to display the module configuration parameters in fortitude.

Here is a complete module.json example of a redis module:

```
{
  "name": "redis",
  "version": "2.8.19",
  "submodules": [],
  "scripts": {
    "configure": "configure.js",
    "start": "start.js",
    "stop": "stop.js"
  },
  "schema": {
    "configure": {
      "port": {"type": "integer", "title": "Redis Port", "default": 6379, "minimum": 1025, "maximum": 65535, "required": true}
    }
  }
}

```

In this case, the full name of the module is `redis@2.8.19`.

### Module Creation

To create a module run the following command:

```
bin/outpost module pack --dir <module-dir> --out <out-dir>
```

This will create a package file suitable for serving from the registry. Optional command line options:

* `module-dir` is the module directory to pack, which is expected to contain a module.json file (defaults to "module").
* `out-dir` is the directory where the output module is to be written (defaults to ".")

### Modules Registry

Modules are hosted in *modules registry*. The registry is a static file http server that outpost contacts
to download modules. It can even be an [AWS S3 bucket](https://aws.amazon.com/s3/).

The path to a module inside the registry is `<registry url>/<name>/<name-version>/<name-version[-platform]>.tar.gz`.

For example:

```
<registry>
  |- redis
  |  |- redis-2.8.19
  |  |  |- redis-2.8.19-linux.tar.gz
  |  |  '- redis-2.8.19-darwin.tar.gz
  '- logrotate
     '- logrotate-3.9.0
        |- logrotate-3.9.0-linux.tar.gz
        '- logrotate-3.9.0.tar.gz
```

### Module Lifecycle

A module lifecycle consists of the following phases:

* `install` - installation of the module
* `configure` - configuration of the module after it was installed
* `start` - start the module after it was configured
* `stop` - stop the module if it is started
* `uninstall` - uninstall the module if it is installed

A module can specify a script to run in every lifecycle phase.
The script to run is defined in `module.json` under the `scripts` element.

```
"scripts": {
  "configure": "configure.js",
  "start": "start.js",
  "stop": "stop.js"
}

```

In this example, no script will run during the `install` and `uninstall` phases, but outpost will execute the
corresponding scripts during the `configure`, `start` and `stop` phases.

#### Install Phase

The `install` phase is the first phase in the life of a module. Outpost relies on the `registry` and the `root` folder
defined in the outpost configuration for installing a module.

Outpost performs the following steps to install a module:

* Search for the module package in the registry. It first tries platform specific package, and if it's not found
then outpost searches for the generic version.
* Download the module from the registry and save it to the `cache` folder (inside the root folder)
* Unpack the module into the `modules` folder (inside the root folder)
* Recursively install all submodules that are defined in the `module.json` file
* Execute the `install` phase script of the downloaded module

##### Command Line Install

Installing a module requires specifying the full name of the module.

```
bin/outpost install <name>@<version>
```

#### Configure Phase

The `configure` phase is the second phase in the life of a module. This phase is responsible for performing any and all
configuration tasks of the installed module.

Outpost performs the following steps to configure a module:

* Search for the installed module in the `modules` directory (by full name or short name)
* Execute the `configure` script of the module passing it the specified configuration

##### Command Line Configure

It is not required to specify the full name of the module. Specifying just the module name causes outpost to search for
an installed module with that name, and if only one version is installed, it is selected as the module to configure.

The configuration itself can either be a path to a file containing the configuration, or a complete JSON string.

```
# configure using full module name
bin/outpost configure <name>@<version> --config <configuration>

# configure using just the module name
bin/outpost configure <name> --config <configuration>
```

#### Start Phase

The `start` phase is the third phase in the life of a module. It is responsible for launching one or more processes
and having the outpost agent monitor them.

Outpost performs the following steps to start a module:

* Search for the installed module in the `modules` directory (by full name or short name)
* Execute the `start` script of the module

##### Command Line Start

It is not required to specify the full name of the module. Specifying just the module name causes outpost to search for
an installed module with that name, and if only one version is installed, it is selected as the module to start.

```
# start using full module name
bin/outpost start <name>@<version>

# start using just the module name
bin/outpost start <name>
```

#### Stop Phase

The `stop` phase is responsible for stopping all of the processes that the `start` phase has created.

Outpost performs the following steps to stop a module:

* Search for the installed module in the `modules` directory (by full name or short name)
* Execute the `stop` script of the module

##### Command Line Stop

It is not required to specify the full name of the module. Specifying just the module name causes outpost to search for
an installed module with that name, and if only one version is installed, it is selected as the module to stop.

```
# stop using full module name
bin/outpost stop <name>@<version>

# stop using just the module name
bin/outpost stop <name>
```

#### Uninstall Phase

The `uninstall` phase is responsible for removing the module from the `modules` directory and
stopping all module processes.

The module package remains in the `cache` so that if the module is installed again, it will not be downloaded from the
registry again.

Outpost performs the following steps to uninstall a module:

* Search for the installed module in the `modules` directory (by full name or short name)
* Execute the `stop` script of the module
* Execute the `uninstall` script of the module
* Delete the module directory from the `modules` directory

##### Command Line Uninstall

It is not required to specify the full name of the module. Specifying just the module name causes outpost to search for
an installed module with that name, and if only one version is installed, it is selected as the module to uninstall.

```
# uninstall using full module name
bin/outpost uninstall <name>@<version>

# uninstall using just the module name
bin/outpost uninstall <name>
```

## Module Lifecycle Scripts

Module lifecycle scripts are invoked by outpost during phase execution. A script is responsible for performing all the
necessary tasks to complete the phase successfully. Not all modules require running a script in every phase.
In most cases, only the `configure`, `start` and `stop` phases will require a script.

#### The `outpost` Object

An object named `outpost` is available in the global scope of an executed script.
The `outpost` object provides functions that are necessary to execute the script correctly as well as some
utility functions.

##### outpost.opconfig

The outpost configuration.

##### outpost.config

The configuration specific to the script execution. Configuration string values may contain parameters of the
form `${<param>}` that are evaluated before they are passed to the script for processing. Param names must exist 
in the global scope, for example `${process.env['USER']}` and `${outpost.opconfig.root}` are valid values since both 
`process` and `outpost` are objects in the global scope of the script.

##### outpost.proxy

The proxy information configured for this outpost agent or `null` if there is no proxy configured.

The proxy configuration contains the following fields:

* `url` - proxy url of the form http[s]://[user:password@]hostname[:port]
* `authType` - either `basic` or `ntlm`
* `ntlmDomain` - the NTLM domain if the authentication is NTLM

##### outpost.log(message)

Log a message to the outpost log

* `message` - the message to log

##### outpost.done()

Mark the script as completed successfully. Not further actions are allowed after calling `outpost.done()`.

##### outpost.fail(message)

Mark the script as failed to complete. Not further actions are allowed after calling `outpost.fail()`.

* `message` - the failure message

##### outpost.monitor(info, cb)

Register a process to be monitored by outpost. Outpost will start the process and continuously monitor that it is running.

* `info` - the process information:
 * `name` - [required] the unique name of this monitored process used to identify this process in all later commands
 * `cmd` - the executable to execute. default is the node process that also started outpost
 * `args` - array of command line options to pass to the started process
 * `cwd` - the cwd for the process to monitor. default is the current module directory
 * `env` - an object of environment variables for the launched process. defaults to the outpost environment variables
 * `uid` - user id to use for the launched process. defaults to the outpost user id
 * `gid` - group id to use for the launched process. defaults to the outpost group id
 * `timeout` - time in seconds to wait for the process to actually start. defaults to 10 seconds
 * `checks` - array of process checks. if a check fails, the process is restarted. the following checks are available:
  * `maxUpTime` - maximum time in minutes to allow the process to be up and running.
  *               example: {type: 'maxUpTime', time: 24*60}
  * `fileLastModified` - check that a file was modified in a time frame specified in seconds.
  *                      example: {type: 'fileLastModified', file: '/path/to/file', time: 5*60}
 * `logFile` - the log file for the process stdout and stderr. defaults to the logsDir setting as specified in the outpost configuration
 * `pidFile` - a custom pid file that stores the process id to monitor. defaults to the process id of the process that is launched
 * `stopSignal` - the signal to use to stop the process. default is SIGTERM
* `cb` - a callback to be invoked when the process has been launched. The callback receives an error if the process failed to launch

##### outpost.unmonitor(info, cb)

Unregister a process to no longer be monitored by outpost. Outpost will stop the process and stop monitoring it.

* `info` - the process information:
 * `name` - [required] the unique name of this monitored process to unmonitor
 * `timeout` - time in seconds to wait for the process to actually stop. defaults to 10 seconds
* `cb` - a callback to be invoked when the process has been stopped. The callback receives an error if the process failed to stop

##### outpost.script(module, config, cb)

Run a script of a submodule. The script that will run is of the same lifecycle phase as the current script.

* `module` - the module name whose script is to be run
* `config` - the configuration to pass to the executed script
* `cb` - invoked when the script is done. receives an error if the script failed.

##### outpost.template(template, context, output, cb)

Render a template. Templates are processed as [Mustache](http://mustache.github.io/mustache.5.html) or
as [EJS](http://ejs.co/) templates. If the input file name ends with `.ejs` then the EJS template engine is used.
In all other cases the Mustache template engine is used.

* `template` - input template. may be a file name or the complete template string
* `context` - the context object for rendering the template
* `output` - the output file to contain to template processing result

##### outpost.http(options, cb)

Perform an HTTP request, automatically going through the proxy if one is defined for this agent.

* `options` - request options:
  * `url` - (required) target of the request
  * `method` - request method (GET, PUT, POST, DELETE). default is GET
  * `data` - data to send on the request. default is `undefined`.
* `cb` - invoked when the request is done with `(err, data, response)` where `data` is the complete body of the response.

##### outpost.tail(file, [limit,] cb)

Read lines from the end of the specified file up to limit number of bytes and return the contents.

* `file` - the file to read lines from the end
* `limit` - limit maximum number of bytes to read. default is 10k
* `cb` - callback of the form `(err, content)`

##### outpost.logTail(file, [limit,] cb)

Read lines from the end of the specified file up to limit number of bytes and print the contents to the outpost log.

* `file` - the file to read lines from the end
* `limit` - limit maximum number of bytes to read. default is 10k
* `cb` - callback of the form `(err)`

##### outpost.exec(cmd, options, cb)

Execute a command line. `stderr` is automatically redirected to `stdout` so there is no need to specify
that explicitly on the command line.

* `cmd` - the command line to execute
* `options` - options for the command:
 * `cwd` - the working directory to execute the command from
 * `timeout` - time to wait (in seconds) for the command to complete before it is forcefully terminated
* `cb` - the command execution completion callback:
 * `code` - the exit code of the command
 * `signal` - if the command exited with an error because of timeout or some other signal
* `output` - the console output (stderr and stdout merged)

## Module Example

To best explain how to create a module, we'll go through a simple example [Redis](http://redis.io) module.

Once installed and configured, this module starts a redis-server on a configurable port.

#### Redis Module Contents

```
|-config.json.tpl
|-configure.js
|-module.json
|-start.js
|-stop.js
'-redis-server

```

#### Redis `module.json`
```javascript
{
  "name": "redis",
  "version": "2.8.19",
  "scripts": {
    "configure": "configure.js",
    "start": "start.js",
    "stop": "stop.js"
  }
}
```

#### Redis Configure Script

```javascript
// print to the outpost log
outpost.log('redis configure script started');

// generate a file from a template
outpost.template('config.json.tpl', outpost.config, 'config.json', function(err) {
  if (err) {
    // it failed, fail the script
    outpost.fail(err);
  } else {
    // it worked!
    outpost.log('redis configuration script is done!');
    outpost.done();
  }
});
```

The `configure.js` script generates a file containing the port that the redis server should accept connections on.
This is done using the `outpost.template()` function that generates the config file from a template file.

The template file `config.json.tpl` contains:

```javascript
{"port": {{serverPort}}}
```

Running the `configure` phase with a configuration of:

```javascript
{"serverPort": 5678}
```

generates the file `config.json` that ends up containing:

```javascript
{"port": 5678}
```

The last thing the `configure.js` does is call `outpost.done()` to specify the successful completion of the script.

#### Redis Start Script

```javascript
// print to the outpost log
outpost.log('redis start script started');

// load the configuration file that was generated in the configure phase
var config = require('./config.json');

outpost.log('starting redis on port ' + config.port);

// register the redis-server process with the outpost process monitor
outpost.monitor({name: 'redis', cmd: './redis-server', args: ['--port', config.port]}, function(err) {
  if (err) {
    outpost.fail('redis failed to start: ' + err);
  } else {
    outpost.log('redis server started!');
    outpost.done();
  }
});
```

The `start.js` script loads the configuration file that was generated during the `configure` phase
and registers a process with the outpost process monitor service so that it will launch it and continuously
monitor that it running.

The last thing the `start.js` script does is call `outpost.done()` to specify the successful completion of the script.

#### Redis Stop Script

```javascript
// print to the outpost log
outpost.log('redis stop script started');

// remove the redis process from the outpost monitoring service.
outpost.unmonitor({name: 'redis'}, function(err) {
  if (err) {
    outpost.fail('redis failed to stop: ' + err);
  } else {
    outpost.log('redis server stopped!');
    outpost.done();
  }
});
```

The `stop.js` script unregisters the 'redis' process from the outpost process monitor service. This will automatically
stop the process.

The last thing the `stop.js` script does is call `outpost.done()` to specify the successful completion of the script.

## Submodules

A module may depend on other modules for added functionality. These modules are children of the module
that declared the use of them, hence they are _submodules_.

Submodules of a module are accessible to that module only; they are not shared between modules.

Outpost automatically downloads and unpacks submodules when installing a module, but it _does not_ automatically
execute the lifecycle phase script of the submodules. It is a module's responsibility to execute the lifecycle scripts
of submodules in the correct order.

#### Submodule Lifecycle Scripts

A module script can execute a script of a submodule by using the [outpost.script()](#outpostscriptmodule-config-cb) function,
however it is restricted to running the _same lifecycle_ script only.
This means that the `configure` script cannot execute the `start` script of a submodule,
only the `configure` script of the submodule can be executed.

## License

The MIT License (MIT)

Copyright (c) 2015 Capriza Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

