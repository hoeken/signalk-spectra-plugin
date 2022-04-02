const id = "signalk-spectra-plugin";
const debug = require('debug')(id)
const WebSocket = require('ws')

var ws
var plugin = {}

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = id
  plugin.name = "Spectra Watermaker plugin"
  plugin.description = "Signal K plugin to read Spectra Watermaker data"

  var unsubscribes = []

  var schema = {
    type: "object",
    title: "Spectra Watermaker",
    description: "",
    properties: {
      IP: {
	      type: 'string',
	      title: 'IP address of watermaker',
	      default: '192.168.x.x'
      }
    }
  }

  plugin.schema = function() {
    return schema
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('Starting plugin');
    app.debug('Options: %j', JSON.stringify(options));

    const SpectraIP = options.IP;

    const url = 'ws://' + SpectraIP + ':9001'
    ws = new WebSocket(url, ['dumb-increment-protocol'])
 
    ws.onopen = () => {
      app.debug('Connected to Spectre watermaker') 
    }
 
    ws.onclose = () => {
      app.debug('Disconnecting from Spectre watermaker') 
    }
 
    ws.onerror = (error) => {
      app.debug(`WebSocket error: ${error}`)
    }
 
    ws.onmessage = (e) => {
      handleData(e.data)
    }

    function handleData (json) {
      var updateValues = []
      var dataObj = JSON.parse(json)
      for (var [key, value] of Object.entries(dataObj)) {
        switch (key) {
          case 'device':
            break
          default:
            value = parseFloat(value.split(' ')[0])
            break
        }
        var update = {
          path: 'watermaker.spectra.' + key,
          value: value
        }
        updateValues.push(update)
      }
      var updates = { updates: [ { values: updateValues } ] }
      app.debug(JSON.stringify(updates))
      app.handleMessage(plugin.id, updates)
    }
  }

  plugin.stop = function() {
    app.debug("Stopping")
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    ws.close()
    app.debug("Stopped")
  }

  return plugin;
};

module.exports.app = "app"
module.exports.options = "options"
