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

          //parse our autostore and save it.
          var m
          if ((m = autostore_regex.exec(dataObj.label1)) !== null) {
            var autostore = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)

            var update = {
              path: 'watermaker.spectra.autostore',
              value: autostore
            }
            updateValues.push(update)
          }
          
          break

        //page 5 = running - product
        //0 = stop
        case '5':
          wm_state = 'running'
          break

        //page 6 = running - pressure
        //0 = stop
        case '6':
          wm_state = 'running'
          break

        //page 7 = main prefs page
        //{ page: '7', button0: 'Calibrate Sensors', button1: 'Estimated Service Interval', button2: 'System Data', button3: 'Support', button4: 'Fault Alarms', button5: 'User Settings', button6: 'Dealer Access Point', button7: 'User Configurations', button8: 'Restart' }
        case '7':
          wm_state = 'idle'
          break

        //page 10 = running - system starting???
        //0 = stop

        //page 10 = idle / autostore waiting
        //also a generic ok page
        //{ page: '10', button0: 'MENU', label0: 'AUTOSTORE MODE', label1: 'Autostore : 4d 22h 46m', alarm: 'OFF' }
        //0 = menu
        case '10':
          wm_state = 'idle'
          
          //parse our autostore and save it.
          var m
          if ((m = autostore_regex.exec(dataObj.label1)) !== null) {
            var autostore = (m[2] * 24 * 60 * 60) + (m[4] * 60 * 60) + (m[5] * 60)

            var update = {
              path: 'watermaker.spectra.autostore',
              value: autostore
            }
            updateValues.push(update)
          }
          
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
        case '30':
          wm_state = 'running'
          break
      
        //page 31 = running - system details
        //0 = stop
        case '31':
          wm_state = 'running'
          break
      
        //page 32 = running - main dashboard
        //0 = stop
        case '31':
          wm_state = 'running'
          break
      
        //page 37 = choose your run mode
        //0  = filltank
        //1 = autorun
        case '30':
          wm_state = 'idle'
          break
      
        //page 34 = estimated service interval
        //{ "page": "34", "label0": "ESTIMATED SERVICE INTERVAL", "label1": "Autostore Timer<br\/>   4d 22h 38m", "label2": "Tank 1", "label3": "Pre filter    : 100.00%", "label4": "Feed Pump     : 89.79%", "label5": "Carbon filter : 98.23%", "label6": "Membrane      : 85.19%", "label7": "Clark Pump    : 94.90%", "label8": " ", "label9": " ", "gauge0": "0", "gauge0_label": "0%", "toggle_level": "0" }
        case '34':
          wm_state = 'idle'
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
  }

  /*
  var tsreply_object = {
    page: cur_page,
    cmd: "BUTTON0"
  };
  */ 

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
