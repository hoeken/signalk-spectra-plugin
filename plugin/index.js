const id = "signalk-spectra-plugin";
const debug = require('debug')(id)
const WebSocket = require('ws')

var ws
var ws2
var plugin = {}

var wm_state = 'unknown'
var wm_page = 0

/* TODO List:

- Add calls to browse the system info and service interval pages on startup.
- Make that a function as well that can be called by PUT
- Add a call on startup to move 1 page left to get the elapsed and filter quality
- Update the readme with info on new features + node red flows + grafana export (if possible... maybe as files in the plugin)
- Add config option to allow control
- Add config option to use old style names/values or use signalk style stuff
- Update meta to cover all of our fields

*/

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = id
  plugin.name = "Spectra Watermaker plugin"
  plugin.description = "SignalK plugin to interface with Spectra Watermakers"

  var unsubscribes = []

  const autostore_regex = /Autostore : ((\d+)d )?((\d+)h )?(\d+)m/gm;
  const elapsed_regex = /((\d+)d )?((\d+)h )?(\d+)m/gm;
  const percent_regex = /((\d+).\d+)%/gm;
  const version_regex = /Firmware Rev.  : v(\d+.\d+.\d+)/gm;

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

  function doStartWatermaker(context, path, value, callback) {
    app.debug("Start watermaker")
    if(wm_state == 'idle')
    {
      //page 10 is our idle 'autostore' countdown page
      if (wm_page == '10')
      {
        //click the button to leave that page
        ws2.send(JSON.stringify({"page":"10","cmd":"BUTTON0"}))

        //delays because we are chaining commands
        setTimeout(function() { ws2.send(JSON.stringify({"page":"4","cmd":"BUTTON1"})) }, 1000)
        setTimeout(function() { ws2.send(JSON.stringify({"page":"37","cmd":"BUTTON0"})) }, 2000);
      }
      //are we already on the main page?
      else if (wm_page == '4')
      {
        ws2.send(JSON.stringify({"page":"4","cmd":"BUTTON1"}))

        //delays because we are chaining commands
        setTimeout(function() { ws2.send(JSON.stringify({"page":"37","cmd":"BUTTON0"})) }, 1000);
      }
      //okay so we are on an unknown page, abort
      else {
        return { state: 'COMPLETED', statusCode: 400 };
      }

      //move to the details page so we can get filter stats
      //setTimeout(function() {
      //  ws2.send(JSON.stringify({"page":"37","cmd":"BUTTON0"}))
      //}, 1000);

      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }
  
  function doStopWatermaker(context, path, value, callback) {
    app.debug("Stop watermaker")
    if(wm_state == 'running'){
      ws2.send(JSON.stringify({"page":wm_page,"cmd":"BUTTON0"}))   
      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }

  function doToggleWatermakerOutputSpeed(context, path, value, callback) {
    app.debug("Toggle watermaker output speed")
    if(wm_state == 'running'){
      ws2.send(JSON.stringify({"page":wm_page,"cmd":"BUTTON3"}))      
      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }
  
  // our metadata for our data fields
  function handleMetas() {
    var metas = [
      {
        path: 'watermaker.spectra.bat_v',
        value: {
          units: 'V',
          description: 'Voltage at drive electronics'
        }
      },
      {
        path: 'watermaker.spectra.boost_p',
        value: {
          units: 'Pa',
          description: 'Boost pump pressure'
        }
      },
      {
        path: 'watermaker.spectra.boost_p',
        value: {
          units: 'Pa',
          description: 'Boost pump pressure'
        }
      },
      {
        path: 'watermaker.spectra.f_flow',
        value: {
          units: 'm3/s',
          description: 'Feed water flowrate'
        }
      },
      {
        path: 'watermaker.spectra.feed_p',
        value: {
          units: 'Pa',
          description: 'Feed pump pressure'
        }
      },
      {
        path: 'watermaker.spectra.p_flow',
        value: {
          units: 'm3/s',
          description: 'Product (output) water flowrate'
        }
      },
      {
        path: 'watermaker.spectra.ph',
        value: {
          units: 'pH',
          description: 'Product (output) water pH'
        }
      },
      {
        path: 'watermaker.spectra.reg_5v',
        value: {
          units: 'V',
          description: 'Internal 5v regulator voltage'
        }
      },   
      {
        path: 'watermaker.spectra.reg_5v',
        value: {
          units: 'V',
          description: 'Internal 5v regulator voltage'
        }
      }, 
      {
        path: 'watermaker.spectra.sal_1',
        value: {
          units: 'ppm',
          description: 'Product (output) water salinity'
        }
      },   
      {
        path: 'watermaker.spectra.sal_2',
        value: {
          units: 'ppm',
          description: 'Feed water salinity'
        }
      },   
      {
        path: 'watermaker.spectra.temp_1',
        value: {
          units: 'K',
          description: 'Feed water temperature'
        }
      },
      {
        path: 'watermaker.spectra.autostore',
        value: {
          units: 's',
          description: 'Seconds before next autostore cycle'
        }
      },
      {
        path: 'watermaker.spectra.elapsed_time',
        value: {
          units: 's',
          description: 'Elapsed time in current run cycle'
        }
      }      
    ]

    // Publish metas only once
    app.handleMessage(plugin.id, {
      updates: [{ 
        meta: metas
      }]
    });
  }
  
  function handleData (json) {
    var updateValues = []
    var dataObj = JSON.parse(json)
    //app.debug(dataObj)
    for (var [key, value] of Object.entries(dataObj)) {
      switch (key) {
        case 'device':
          break
        default:
          value = parseFloat(value.split(' ')[0])
          break
      }

      //zero out some of our variables when we are not running.
      if (wm_state == 'idle' || wm_state == 'unknown') {
        switch (key) {
          case 'boost_p':
          case 'feed_p':
          case 'p_flow':
          case 'sal_1':
          case 'sal_2':
            value = 0
            break
        }
      }
      
      //prepare our update
      var update = {
        path: 'watermaker.spectra.' + key,
        value: value
      }
      updateValues.push(update)
    }
    var updates = { updates: [ { values: updateValues } ] }
    //app.debug(JSON.stringify(updates))
    app.handleMessage(plugin.id, updates)
  }
  
  function parseAutostore(json, updateValues) {
    //parse our autostore and save it.
    var m
    if ((m = autostore_regex.exec(json.label1)) !== null) {
      var autostore = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)

      if (m[2])
        var autostore = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)
      else if (m[4])
        var autostore = (m[4] * 60 * 60) + (m[5] * 60)
      else
        var autostore = (m[5] * 60)

      updateValues.push({
        path: 'watermaker.spectra.autostore',
        value: autostore
      })
    }
    
    return updateValues;
  }

  function parseProductionSpeed(json, updateValues) {
    //parse our autostore and save it.
    if (json.toggle_button == '1'){
      updateValues.push({
          path: 'watermaker.spectra.productionSpeed',
          value: 'high'
      })
    }
    else if (json.toggle_button == '0'){
      updateValues.push({
          path: 'watermaker.spectra.productionSpeed',
          value: 'low'
      })
    }
    
    return updateValues
  }
  
  function parseElapsedTime(json, updateValues) {
    var m
    if ((m = elapsed_regex.exec(json.label8)) !== null) {
      app.debug(m)
      
      if (m[2])
        var elapsed_time = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)
      else if (m[4])
        var elapsed_time = (m[4] * 60 * 60) + (m[5] * 60)
      else
        var elapsed_time = (m[5] * 60)

      updateValues.push({
        path: 'watermaker.spectra.elapsed_time',
        value: elapsed_time
      })
    }

    return updateValues
  }
  
  function parseFilterCondition(json, updateValues) {
    var m
    if ((m = percent_regex.exec(json)) !== null) {
      var percent = parseFloat(m[1])/100

      updateValues.push({
        path: 'watermaker.spectra.filterCondition',
        value: percent
      })
    }

    return updateValues
  }
  
  function parseFeedPumpCondition(json, updateValues) {
    var m
    if ((m = percent_regex.exec(json)) !== null) {
      var percent = parseFloat(m[1])/100

      updateValues.push({
        path: 'watermaker.spectra.feedpumpCondition',
        value: percent
      })
    }

    return updateValues
  }

  function parseCarbonFilterCondition(json, updateValues) {
    var m
    if ((m = percent_regex.exec(json)) !== null) {
      var percent = parseFloat(m[1])/100

      updateValues.push({
        path: 'watermaker.spectra.carbonFilterCondition',
        value: percent
      })
    }

    return updateValues
  }

  function parseMembraneCondition(json, updateValues) {
    var m
    if ((m = percent_regex.exec(json)) !== null) {
      var percent = parseFloat(m[1])/100

      updateValues.push({
        path: 'watermaker.spectra.membraneCondition',
        value: percent
      })
    }

    return updateValues
  }
  
  function parseClarkPumpCondition(json, updateValues) {
    var m
    if ((m = percent_regex.exec(json)) !== null) {
      var percent = parseFloat(m[1])/100

      updateValues.push({
        path: 'watermaker.spectra.clarkPumpCondition',
        value: percent
      })
    }

    return updateValues
  }
  
  function parseVersionInfo(json, updateValues) {
    var m
    if ((m = version_regex.exec(json)) !== null) {
      var version = m[1]

      updateValues.push({
        path: 'watermaker.spectra.version',
        value: version
      })
    }

    return updateValues
  }
  
  function handleData2 (json)
  {
    var dataObj = JSON.parse(json)
    
    //app.debug(dataObj)
    
    var updateValues = []
    
    //what page is the UI on?
    wm_page = dataObj.page
    switch (wm_page)
    {
      //page 1 = save/discard
      case '1':
        wm_state = 'idle'
        break
      
      //page 2 = fresh water flush in progress
      case '2':
        wm_state = 'freshwater_flush'
        break
      
      //main menu
      //button 0 = fresh water flush
      //button 1 = start
      //button 2 = stop
      case '4':
        wm_state = 'idle'
        updateValues = parseAutostore(dataObj, updateValues)
        break

      //page 5 = running - product
      //button 0 = stop
      case '5':
      //page 6 = running - pressure
      //button 0 = stop
      case '6':
        wm_state = 'running'
        updateValues = parseProductionSpeed(dataObj, updateValues)
        break

      //page 7 = main prefs page
      case '7':
        wm_state = 'idle'
        break

      //page 10 = system startup countdown
      //page 10 = 'screensaver' main page
      //also a generic ok page - wish they didnt re-use this one
      //button 0 = menu
      case '10':
        wm_state = 'idle'
        updateValues = parseAutostore(dataObj, updateValues)
        break
    
      //page 12 = choose liter quantity
      case '12':
        wm_state = 'idle'
        break
        
      //page 17 = support
      case '17':
        wm_state = 'idle'
        updateValues = parseVersionInfo(dataObj.label0, updateValues)
        break  

      //page 25 = system data
      case '25':
        wm_state = 'idle'
        break
    
      //page 29 = choose autorun
      //3 = start
      //label1 = amount
      //label2 = liters
      //label3 = hours
      case '29':
        wm_state = 'idle'
        break
    
      //page 30 = running - prefilter condition
      //0 = stop
      case '30':
        wm_state = 'running'
        updateValues = parseProductionSpeed(dataObj, updateValues)
        break
    
      //page 31 = running - system details
      case '31':
        wm_state = 'running'
        
        updateValues = parseProductionSpeed(dataObj, updateValues)
        updateValues = parseElapsedTime(dataObj, updateValues)
        updateValues = parseFilterCondition(dataObj.label7, updateValues)
        
        break
    
      //page 32 = running - main dashboard
      case '32':
        wm_state = 'running'
        updateValues = parseProductionSpeed(dataObj, updateValues)
        break
    
      //page 30 = choose your run mode
      //0  = filltank
      //1 = autorun
      case '30':
        wm_state = 'idle'
        break
    
      //page 34 = estimated service interval
      case '34':
        wm_state = 'idle'
        
        updateValues = parseFilterCondition(dataObj.label3, updateValues)
        updateValues = parseFeedPumpCondition(dataObj.label4, updateValues)
        updateValues = parseCarbonFilterCondition(dataObj.label5, updateValues)
        updateValues = parseMembraneCondition(dataObj.label6, updateValues)
        updateValues = parseClarkPumpCondition(dataObj.label7, updateValues)
        
        break
    
      //page 43 = freshwater flush warning dismiss
      //0 = dismiss
      case '43':
        wm_state = 'idle'
        break

      //page 100 = working / loading
      case '100':
        wm_state = 'idle'
        break

      //unknown page here
      default:
        wm_state = 'idle'
        app.debug(dataObj)     
        break
    }
    
    //update with our current state
    var update = {
        path: 'watermaker.spectra.state',
        value: wm_state
    }
    updateValues.push(update)

    //lets keep our page too, cant hurt
    var update = {
        path: 'watermaker.spectra.uiPage',
        value: wm_page
    }
    updateValues.push(update)

    var updates = { updates: [ { values: updateValues } ] }
    //app.debug(JSON.stringify(updates))
    app.handleMessage(plugin.id, updates)
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('Starting plugin');
    app.debug('Options: %j', JSON.stringify(options));
    
    handleMetas()
    
    //register all our put handlers
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.start', doStartWatermaker, 'signalk-spectra-plugin');
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.stop', doStopWatermaker, 'signalk-spectra-plugin');
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.toggleSpeed', doToggleWatermakerOutputSpeed, 'signalk-spectra-plugin');

    const SpectraIP = options.IP;
    const url = 'ws://' + SpectraIP + ':9001'
    ws = new WebSocket(url, ['dumb-increment-protocol'])
 
    ws.onopen = () => {
      app.debug('Connected to Spectra watermaker') 
    }
 
    ws.onclose = () => {
      app.debug('Disconnecting from Spectra watermaker') 
    }
 
    ws.onerror = (error) => {
      app.debug(`WebSocket error: ${error}`)
    }
 
    ws.onmessage = (e) => {
      handleData(e.data)
    }
    
    const url2 = 'ws://' + SpectraIP + ':9000'
    ws2 = new WebSocket(url2, ['dumb-increment-protocol'])
 
    ws2.onopen = () => {
      app.debug('Connected to Spectra watermaker') 
    }
 
    ws2.onclose = () => {
      app.debug('Disconnecting from Spectra watermaker') 
    }
 
    ws2.onerror = (error) => {
      app.debug(`WebSocket error: ${error}`)
    }
 
    ws2.onmessage = (e) => {
      handleData2(e.data)
    }
  }

  plugin.stop = function() {
    app.debug("Stopping")
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    ws.close()
    ws2.close()
    app.debug("Stopped")
  }

  return plugin;
};

module.exports.app = "app"
module.exports.options = "options"
