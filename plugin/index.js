const id = "signalk-spectra-plugin";
const debug = require('debug')(id)
const WebSocket = require('ws')

var data_ws
var ui_ws
var plugin = {}

var wm_state = 'unknown'
var wm_page = 0

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = id
  plugin.name = "Spectra Watermaker plugin"
  plugin.description = "SignalK plugin to interface with Spectra Watermakers"

  var unsubscribes = []

  //various regexes
  const autostore_regex = /Autostore : ((\d+)d )?((\d+)h )?(\d+)m/gm;
  const elapsed_regex = /((\d+)d )?((\d+)h )?(\d+)m/gm;
  const percent_regex = /((\d+)(.\d+)?)%/gm;
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
      },
      allowPuts: {
	      type: 'boolean',
	      title: 'Allow PUT interface for controlling the watermaker externally. See plugin github for details on usage.',
	      default: true
      },
      allowDetailedStats: {
	      type: 'boolean',
	      title: 'Allow detailed stats. This will cause user display to scroll through pages occasionally, but will enable statistics on service intervals, elapsed time, etc.',
	      default: true
      },
      useSignalKStyleValues: {
	      type: 'boolean',
	      title: 'Log SignalK style values (SI units and camelCase) (default in 1.0.0) or old raw values (default in 0.0.2)',
	      default: true
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
      //commands to start
      var commands = [
        {"page":"4","cmd":"BUTTON1"},
        {"page":"37","cmd":"BUTTON0"}
      ]

      //page 10 is our idle 'autostore' countdown page, so add this to the beginning
      if (wm_page == '10')
        commands.unshift({"page":"10","cmd":"BUTTON0"})

      //are we already on the main page?
      if (wm_page == '4' || wm_page == '10')
      {
        queueUICommands(commands)
        
        //this will switch to our data page after startup
        if (plugin.options.allowDetailedStats)
          setTimeout(runUICommand,(commands.length+1) * 15000, {"page":"32","cmd":"BUTTON1"});

        return { state: 'COMPLETED', statusCode: 200 };
      }
    }
    return { state: 'COMPLETED', statusCode: 400 };
  }
  
  function doStartWatermaker(context, path, value, callback) {
    app.debug("Start watermaker")
    
    if (value.mode)
    {
      if(wm_state == 'idle')
      {
        //empty commands array
        var commands = []
      
        //page 10 is our idle 'autostore' countdown page, so add this to the beginning
        if (wm_page == '10')
          commands.push({"page":"10","cmd":"BUTTON0"})
      
        //hit the 'start' button
        commands.push({"page":"4","cmd":"BUTTON1"})

        //filltank is just a single button
        if(value.mode == 'filltank')
          commands.push({"page":"37","cmd":"BUTTON0"})
        //or use the autofill mode
        else if (value.mode == 'autofill')
        {
          commands.push({"page":"37","cmd":"BUTTON1"})
          if (value.liters)
          {
            commands.push({"page":"29","cmd":"BUTTON1"})
            commands.push({"page":"29","cmd":"LABEL0"})
            commands.push({"page":"12","data":value.liters})
            commands.push({"page":"29","cmd":"BUTTON3"})
          }
          //run for a set # of hours
          else if (value.hours)
          {
            commands.push({"page":"29","cmd":"BUTTON2"})
            commands.push({"page":"29","cmd":"LABEL0"})
            commands.push({"page":"12","data":value.hours})
            commands.push({"page":"29","cmd":"BUTTON3"})
          }
        }

        //are we already on the main page?
        if (wm_page == '4' || wm_page == '10')
        {
          queueUICommands(commands)
        
          //this will switch to our data page after startup
          if (plugin.options.allowDetailedStats)
            setTimeout(runUICommand,(commands.length+1) * 1500 + 15000, {"page":"32","cmd":"BUTTON1"});

          return { state: 'COMPLETED', statusCode: 200 };
        }
      }
    }
    return { state: 'COMPLETED', statusCode: 400 };
  }
  
  function doStopWatermaker(context, path, value, callback) {
    app.debug("Stop watermaker")
    if(wm_state == 'running'){
      runUICommand({"page":wm_page,"cmd":"BUTTON0"})
      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }

  function doToggleWatermakerOutputSpeed(context, path, value, callback) {
    app.debug("Toggle watermaker output speed")
    if(wm_state == 'running'){
      runUICommand({"page":wm_page,"cmd":"BUTTON3"})     
      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }

  function doLookupStats(context, path, value, callback) {
    app.debug("Looking up stats")
    if(wm_state == 'idle' && plugin.options.allowDetailedStats){
      loadAllStats()
      return { state: 'COMPLETED', statusCode: 200 };
    } else {
      return { state: 'COMPLETED', statusCode: 400 };
    }
  }
  
  function loadAllStats() {
    let commands = [
      {"page":"4","cmd":"BUTTON4"},
      {"page":"7","cmd":"BUTTON1"},
      {"page":"34","cmd":"BUTTON0"},
      {"page":"7","cmd":"BUTTON2"},
      {"page":"25","cmd":"BUTTON0"},
      {"page":"7","cmd":"BUTTON3"},
      {"page":"17","cmd":"BUTTON5"},
      {"page":"7","cmd":"BUTTON9"},
      {"page":"7","cmd":"BUTTON9"},
      {"page":"1","cmd":"BUTTON1"}
    ]
    
    //page 10 is our idle 'autostore' countdown page, so we need to skip it first
    if (wm_page == '10')
      commands.unshift({"page":"10","cmd":"BUTTON0"})

    //loop through them.
    if (wm_page == '4' || wm_page == '10')
      queueUICommands(commands)
  }
  
  function queueUICommands(commands){
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i]
      setTimeout(runUICommand,(i+1) * 1500, cmd);
    }
  }
  
  function runUICommand(cmd) {
    ui_ws.send(JSON.stringify(cmd))
    //app.debug("Running command: " + JSON.stringify(cmd))
  }
  
  // our metadata for our data fields
  function handleMetas() {
    var metas = [
      {
        path: 'watermaker.spectra.timeToAutostore',
        value: {
          units: 's',
          description: 'Seconds before next autostore cycle'
        }
      },
      {
        path: 'watermaker.spectra.elapsedTime',
        value: {
          units: 's',
          description: 'Elapsed time in current run cycle'
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
        path: 'watermaker.spectra.carbonFilterCondition',
        value: {
          units: '%',
          description: 'Health of the carbon fresh water flush filter'
        }
      },   
      {
        path: 'watermaker.spectra.clarkPumpCondition',
        value: {
          units: '%',
          description: 'Health of the Clark pump'
        }
      },      
      {
        path: 'watermaker.spectra.feedPumpCondition',
        value: {
          units: '%',
          description: 'Health of the feed pump'
        }
      },      
      {
        path: 'watermaker.spectra.filterCondition',
        value: {
          units: '%',
          description: 'Health of the feed water prefilter'
        }
      },      
      {
        path: 'watermaker.spectra.membraneConditon',
        value: {
          units: '%',
          description: 'Health of the RO membrane'
        }
      },      
      
    ]
    
    //are we using new style values or old style?
    if (plugin.options.useSignalKStyleValues)
    {
      metas = metas.concat([
        {
          path: 'watermaker.spectra.batteryVoltage',
          value: {
            units: 'V',
            description: 'Voltage at drive electronics'
          }
        },
        {
          path: 'watermaker.spectra.regulatorVoltage',
          value: {
            units: 'V',
            description: 'Internal 5v regulator voltage'
          }
        },
        {
          path: 'watermaker.spectra.boostPressure',
          value: {
            units: 'Pa',
            description: 'Boost pump pressure'
          }
        },
        {
          path: 'watermaker.spectra.feedWaterFlowrate',
          value: {
            units: 'LPH',
            description: 'Feed water flowrate'
          }
        },
        {
          path: 'watermaker.spectra.feedWaterPressure',
          value: {
            units: 'Pa',
            description: 'Feed pump pressure'
          }
        },
        {
          path: 'watermaker.spectra.productWaterFlowrate',
          value: {
            units: 'LPH',
            description: 'Product (output) water flowrate'
          }
        },
        {
          path: 'watermaker.spectra.productWaterSalinity',
          value: {
            units: 'ppm',
            description: 'Product (output) water salinity'
          }
        },   
        {
          path: 'watermaker.spectra.feedWaterSalinity',
          value: {
            units: 'ppm',
            description: 'Feed water salinity'
          }
        },   
        {
          path: 'watermaker.spectra.feedWaterTemperature',
          value: {
            units: 'K',
            description: 'Feed water temperature'
          }
        }
      ])
    }
    //okay, old style values
    else
    {
      metas = metas.concat([
        {
          path: 'watermaker.spectra.bat_v',
          value: {
            units: 'V',
            description: 'Voltage at drive electronics'
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
          path: 'watermaker.spectra.boost_p',
          value: {
            units: 'psi',
            description: 'Boost pump pressure'
          }
        },
        {
          path: 'watermaker.spectra.f_flow',
          value: {
            units: 'gph',
            description: 'Feed water flowrate'
          }
        },
        {
          path: 'watermaker.spectra.feed_p',
          value: {
            units: 'psi',
            description: 'Feed pump pressure'
          }
        },
        {
          path: 'watermaker.spectra.p_flow',
          value: {
            units: 'gph',
            description: 'Product (output) water flowrate'
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
            units: 'F',
            description: 'Feed water temperature'
          }
        }
      ])
    }

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
      
      //do we want to convert to more SignalK style?
      if (plugin.options.useSignalKStyleValues) {
        switch (key) {
          case 'bat_v':
            key = 'batteryVoltage'
            break
          case 'reg_5v':
            key = 'regulatorVoltage'
            break
          case 'boost_p':
            key = 'boostPressure'
            value = value * 6894.76
            break
          case 'f_flow':
            key = 'feedWaterFlowrate'
            value = value * 3.7854117842063197
            break
          case 'feed_p':
            key = 'feedWaterPressure'
            value = value * 6894.76
            break
          case 'p_flow':
            key = 'productWaterFlowrate'
            value = value * 3.7854117842063197
            break
          case 'sal_1':
            key = 'productWaterSalinity'
            break
          case 'sal_2':
            key = 'feedWaterSalinity'
            break
          case 'temp_1':
            key = 'feedWaterTemperature'
            value = (value - 32) * 5/9 + 273.15
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
        path: 'watermaker.spectra.timeToAutostore',
        value: autostore
      })
    }
    
    return updateValues;
  }

  function parseProductionSpeed(json, updateValues) {
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
      
      if (m[2])
        var elapsedTime = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)
      else if (m[4])
        var elapsedTime = (m[4] * 60 * 60) + (m[5] * 60)
      else
        var elapsedTime = (m[5] * 60)

      updateValues.push({
        path: 'watermaker.spectra.elapsedTime',
        value: elapsedTime
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
        path: 'watermaker.spectra.feedPumpCondition',
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
  
  function handleUIData (json)
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
    
      //page 34 = estimated service interval
      case '34':
        wm_state = 'idle'
        
        updateValues = parseFilterCondition(dataObj.label3, updateValues)
        updateValues = parseFeedPumpCondition(dataObj.label4, updateValues)
        updateValues = parseCarbonFilterCondition(dataObj.label5, updateValues)
        updateValues = parseMembraneCondition(dataObj.label6, updateValues)
        updateValues = parseClarkPumpCondition(dataObj.label7, updateValues)
        break

      //page 37 = choose your run mode
      //0  = filltank
      //1 = autorun
      case '37':
        wm_state = 'idle'
        break
    
      //page 43 = freshwater flush warning dismiss
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
        app.debug("Unknown page: " + JSON.stringify(dataObj))     
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
        value: parseInt(wm_page)
    }
    updateValues.push(update)

    var updates = { updates: [ { values: updateValues } ] }
    //app.debug(JSON.stringify(updates))
    app.handleMessage(plugin.id, updates)
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('Starting plugin');
    app.debug('Options: ' + JSON.stringify(options));
    plugin.options = options
    
    handleMetas()
    
    //register all our put handlers
    if (options.allowPuts)
    {
      app.registerPutHandler('vessels.self', 'watermaker.spectra.control.start', doStartWatermaker, 'signalk-spectra-plugin');
      app.registerPutHandler('vessels.self', 'watermaker.spectra.control.stop', doStopWatermaker, 'signalk-spectra-plugin');
      app.registerPutHandler('vessels.self', 'watermaker.spectra.control.toggleSpeed', doToggleWatermakerOutputSpeed, 'signalk-spectra-plugin');
      app.registerPutHandler('vessels.self', 'watermaker.spectra.control.lookupStats', doLookupStats, 'signalk-spectra-plugin');
    }

    //this is our websocket that connects to the 'data' stream
    const SpectraIP = options.IP;
    const url = 'ws://' + SpectraIP + ':9001'
    data_ws = new WebSocket(url, ['dumb-increment-protocol'])
 
    data_ws.onopen = () => {
      app.debug('Connected to Spectra Watermaker Data socket') 
    }
    data_ws.onclose = () => {
      app.debug('Disconnecting from Spectra Watermaker Data socket') 
    }
 
    data_ws.onerror = (error) => {
      app.debug(`Data WebSocket error: ${error}`)
    }
 
    data_ws.onmessage = (e) => {
      handleData(e.data)
    }
    
    //this is our websocket that connects to the 'ui' stream
    const url2 = 'ws://' + SpectraIP + ':9000'
    ui_ws = new WebSocket(url2, ['dumb-increment-protocol'])
 
    ui_ws.onopen = () => {
      app.debug('Connected to Spectra Watermaker UI socket')

      //let us figure out what page we're on then load data.
      if (options.allowDetailedStats)
        setTimeout(loadAllStats, 3000)
    }
 
    ui_ws.onclose = () => {
      app.debug('Disconnecting from Spectra Watermaker UI socket') 
    }
 
    ui_ws.onerror = (error) => {
      app.debug(`UI WebSocket error: ${error}`)
    }
 
    ui_ws.onmessage = (e) => {
      handleUIData(e.data)
    }
  }

  plugin.stop = function() {
    app.debug("Stopping")
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    data_ws.close()
    ui_ws.close()
    app.debug("Stopped")
  }

  return plugin;
};

module.exports.app = "app"
module.exports.options = "options"
