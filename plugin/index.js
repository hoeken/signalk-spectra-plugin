const id = "signalk-spectra-plugin";
const debug = require('debug')(id)
const WebSocket = require('ws')

var ws
var ws2
var plugin = {}

var wm_state = 'unknown'
var wm_page = 0

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = id
  plugin.name = "Spectra Watermaker plugin"
  plugin.description = "Signal K plugin to interface with Spectra Watermakers"

  var unsubscribes = []

  const autostore_regex = /Autostore : ((\d+)d )?((\d+)h )?(\d+)m/gm;
  const elapsed_regex = /((\d+)d )?((\d+)h )?(\d+)m/gm;
  const percent_regex = /((\d+).\d+)%/gm;

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

  plugin.start = function(options, restartPlugin) {
    app.debug('Starting plugin');
    app.debug('Options: %j', JSON.stringify(options));
    
    // our metadata for our data fields
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
    
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.start', doStartWatermaker, 'signalk-spectra-plugin');
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.stop', doStopWatermaker, 'signalk-spectra-plugin');
    app.registerPutHandler('vessels.self', 'watermaker.spectra.control.toggleSpeed', doToggleWatermakerOutputSpeed, 'signalk-spectra-plugin');

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
    
    function handleData2 (json) {
      var dataObj = JSON.parse(json)
      
      //app.debug(dataObj)
      
      var updateValues = []
      
      //what page is the UI on?
      wm_page = dataObj.page
      switch (wm_page) {
        //page 1 = save/discard
        //{ "page": "1", "button0": "SAVE", "button1": "DISCARD", "label0": "SETTINGS", "label1": "Save your changes?", "bhlp": "0", "alarm": "OFF" }
        case '1':
          wm_state = 'idle'
          break
        
        //page 2 = fresh water flush in progress
        //{ page: '2', button0: 'STOP', label0: 'FLUSH', label1: 'Remaining time : 2m ', gauge0_label: '61%', label3: '', gauge0: '61' }
        //0 = stop
        //page 4 = idle
        case '2':
          wm_state = 'freshwater_flush'
          break
          
          //{ "page": "4", "button0": "FRESH WATER FLUSH", "button1": "START", "button2": "STOP", "label0": "CATALINA 340C", "label1": "Autostore : 4d 23h 59m", "label2": "Tank Level", "label4": "", "gauge0": "0", "gauge0_label": "0%", "logout_button": "0", "tank": "1055" }
        //0 = fresh water flush
        //1 = start
        //2 = stop
        case '4':
          wm_state = 'idle'

          updateValues = parseAutostore(dataObj, updateValues)

          break

        //page 5 = running - product
        //{ "page": "5", "button0": "STOP", "label0": "FILLTANK : PRODUCT", "label1": "", "label2": "Quality", "label3": "", "label4": "Quantity", "label5": "1m", "label6": "Elapsed time", "label7": "0.0%", "label8": "Tank 1", "gauge0": "29", "gauge1": "68", "toggle_button": "1", "gauge0_label": "293ppm", "gauge1_label": "52.0lph", "toggle_tank": "0", "toggle_level": "0", "gauge0_mid": "270" }
        //0 = stop
        case '5':
          wm_state = 'running'

          updateValues = parseProductionSpeed(dataObj, updateValues)

          break

        //page 6 = running - pressure
        //0 = stop
        //{ "page": "6", "button0": "STOP", "label0": "FILLTANK : PRESSURE", "label1": "", "label2": "Boost", "label3": "", "label4": "Feed", "label5": "2m", "label6": "Elapsed time", "label7": "0.0%", "label8": "Tank 1", "gauge0": "61", "gauge1": "65", "toggle_button": "1", "gauge0_label": "1.3bar", "gauge1_label": "6.8bar", "toggle_tank": "0", "toggle_level": "0", "gauge0_mid": "90" }
        case '6':
          wm_state = 'running'
          
          updateValues = parseProductionSpeed(dataObj, updateValues)
          
          break

        //page 7 = main prefs page
        //{ page: '7', button0: 'Calibrate Sensors', button1: 'Estimated Service Interval', button2: 'System Data', button3: 'Support', button4: 'Fault Alarms', button5: 'User Settings', button6: 'Dealer Access Point', button7: 'User Configurations', button8: 'Restart' }
        case '7':
          wm_state = 'idle'
          break

        //page 10 = system startup countdown
        //page 10 = idle / autostore waiting
        //also a generic ok page
        //{ page: '10', button0: 'MENU', label0: 'AUTOSTORE MODE', label1: 'Autostore : 4d 22h 46m', alarm: 'OFF' }
        //0 = menu
        case '10':
          wm_state = 'idle'
          
          updateValues = parseAutostore(dataObj, updateValues)
          
          break
      
        //page 12 = choose liter quantity
        case '12':
          wm_state = 'idle'
          break
          
        //page 17 = support
        //{ "page": "17", "button0": "User Manual", "button1": "FAQs", "button2": "Locate Dealer", "button3": "Contact Spectra", "button4": "Last Faults", "label0": "[ CATALINA 340C ]<br\/><br\/>Serial No.     : XXXXX-XXXXX<br\/>MFD            : Jun 21 2022<br\/>Firmware Rev.  : v1.8.4<br\/>Device IP      : 192.168.2.103<br\/>First Start    : Jun 21 2022<br\/>Total Run Time : 4d 6h 3m<br\/>Water Produced : 5285.38 L" }
        case '17':
          wm_state = 'idle'
          break  

        //page 25 = system data
        //{ "page": "25", "label0": "SYSTEM DATA : CATALINA 340C", "label1": "Filter Life    : 100.00%<br\/>Total Run Time : 4d 6h 3m<br\/>Voltage Level  : 27.16 V<br\/><br\/>[ LAST RUN CYCLE ]<br\/>Run Time       : 7m<br\/>Water Produced : 5.0 L<br\/>Boost Pressure : 1.3 bar<br\/>Feed Pressure  : 6.9 bar<br\/>Quality        : 260 ppm", "label2": "Autostore : 4d 22h 36m", "label3": "Tank 1", "label4": "Last fault : NO faults.", "gauge0": "0", "gauge0_label": "0%", "toggle_level": "0" }
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
        //{ "page": "30", "button0": "STOP", "label0": "FILLTANK : PREFILTER CONDITION", "gauge0_label": "100%", "label1": "3m", "label2": "Elapsed time", "label3": "0.0%", "label4": "Tank 1", "label5": "Boost 1.3bar | Feed 6.9bar", "gauge0": "100", "toggle_button": "1", "toggle_tank": "0", "toggle_level": "0" }
        case '30':
          wm_state = 'running'

          updateValues = parseProductionSpeed(dataObj, updateValues)
          
          break
      
        //page 31 = running - system details
        //0 = stop
        //{ "page": "31", "button0": "STOP", "label0": "CATALINA 340C : SYSTEM DATA", "label1": " Liters per hour  : 53.8 lph", "label2": " Boost Pressure   : 1.3 bar", "label3": " Feed Pressure    : 6.9 bar", "label4": " Product quality  : 282 ppm", "label5": " Water temperature: 28.40 C", "label6": " Voltage          : 26.94 V", "label7": " Filter condition : 100%", "label8": "3m", "label9": "Elapsed time", "label10": "0.0%", "label11": "Tank 1", "toggle_button": "1", "toggle_tank": "0", "toggle_level": "0", "nav_hide": "0" }
        case '31':
          wm_state = 'running'
          
          updateValues = parseProductionSpeed(dataObj, updateValues)
          updateValues = parseElapsedTime(dataObj, updateValues)
          updateValues = parseFilterCondition(dataObj.label7, updateValues)
          
          break
      
        //page 32 = running - main dashboard
        //0 = stop
        //{ "page": "32", "button0": "STOP", "label0": "FILLTANK : MAIN DASHBOARD", "gauge0_label": "2.8bar", "label1": "Feed Pressure", "gauge1_label": "100%", "label2": "Filter Condition", "gauge2_label": "392ppm", "label3": "Quality", "gauge0": "26", "gauge1": "100", "gauge2": "39", "toggle_button": "1", "toggle_tank": "1", "gauge0_mid": "270" }
        //{ "page": "32", "button0": "STOP", "label0": "FILLTANK : MAIN DASHBOARD", "gauge0_label": "2.8bar", "label1": "Feed Pressure", "gauge1_label": "100%", "label2": "Filter Condition", "gauge2_label": "392ppm", "label3": "Quality", "gauge0": "26", "gauge1": "100", "gauge2": "39", "toggle_button": "1", "toggle_tank": "1", "gauge0_mid": "270" }
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
        //{ "page": "34", "label0": "ESTIMATED SERVICE INTERVAL", "label1": "Autostore Timer<br\/>   4d 23h 17m", "label2": "Tank 1", "label3": "Pre filter    : 100.00%", "label4": "Feed Pump     : 89.17%", "label5": "Carbon filter : 96.69%", "label6": "Membrane      : 85.07%", "label7": "Clark Pump    : 94.59%", "label8": " ", "label9": " ", "gauge0": "0", "gauge0_label": "0%", "toggle_level": "0" }
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
        //0 = dismiss
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

      var updates = { updates: [ { values: updateValues } ] }
      //app.debug(JSON.stringify(updates))
      app.handleMessage(plugin.id, updates)
    }
    
    //main page to prefs
    //{"page":"4","cmd":"BUTTON4"}
    
    //prefs to estimated service interval
    //{"page":"7","cmd":"BUTTON1"}
    
    
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
