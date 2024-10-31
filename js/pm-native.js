(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Created by niek on 13/04/16.
 * This module fetches the ad configuration from the OfferEngine API
 */
var logger = require('../util/logger');
var ajax = require('../util/ajax');
var appSettings = require('../appSettings');
var deviceDetector = require('../device/deviceDetector');

/**
 * Fetch the ad configurations to load on the current page from the server
 * @param environment - The environment specific implementations
 * @param applicationId - The applicationId to fetch ad configurations for
 * @param callback - The callback to execute when the configurations are retrieved
 */
function fetchConfiguration(environment, applicationId, callback) {
    if(!applicationId) {
        logger.error('No application ID specified');
        return;
    }

    // We allow an override to specify the ad configurations directly in javascript, rather than
    // Having to fetch it from the server
    if(window.ADLIB_OVERRIDES && window.ADLIB_OVERRIDES.adConfigurations) {
        callback(null, window.ADLIB_OVERRIDES.adConfigurations);
        return;
    }

    var deviceDetails = deviceDetector.getDeviceDetails();

    var pathname = environment.getPathname();
    var formFactor = deviceDetails.formFactor;

    var requestUrl = appSettings.configurationsApiUrl;
    var queryParams = {
        path: pathname,
        device: formFactor,
        "application_id":applicationId
    };

    ajax.get({
        url: requestUrl,
        query: queryParams,
        success: function (data) {
            callback(null, data);
        },
        error: function (err) {
            callback(err, null);
        }
    });
}

module.exports = fetchConfiguration;

},{"../appSettings":8,"../device/deviceDetector":9,"../util/ajax":15,"../util/logger":18}],2:[function(require,module,exports){
/**
 * The main AdLibrary module
 */
var appSettings = require('./appSettings'),
    deviceDetector = require('./device/deviceDetector'),
    logger = require('./util/logger'),
    page = require('./page'),
    AdManager = require('./ads/adManager'),
    utils = require('./utils'),
    events = require('./events');

/**
 * Constructor that creates an instance of the AdLibrary object
 * @param environment - The environment object containing environment specific functions
 * @param [options] - Optional options to initialize the ad library with
 * @constructor
 */
var AdLib = function (environment, options) {
    this.applicationId = options && options.applicationId || this._getApplicationId();

    this.deviceDetails = deviceDetector.getDeviceDetails();
    this.environment = environment;
    this._adProvider = null;
    this.page = page;
    this.adManager = null;
    this.path = window.location.pathname;


    // If the script include is placed in the <head> of the page,
    // document.body is not ready yet, and we need it to retrieve the token
    if (document.body) {
        page.preloadToken(this.environment);
    }
    page.addDomReadyListener(this.environment);

    this._setUpPublicAPI();
};

/**
 * This function sets up the public API on the browsers' window object
 * so that publishers can interact with some functions of the Ad Library should they need to
 */
AdLib.prototype._setUpPublicAPI = function () {
    var instance = this;

    //noinspection JSUnusedGlobalSymbols
    window[appSettings.globalVarName] = {
        ready: true,
        /**
         * Load one or more adUnits manually
         * @param {string[]|string} adUnitNames - The names of the adUnits to remove
         */
        trigger: function (adUnitNames) {
            adUnitNames = utils.stringToArray(adUnitNames);
            instance.trigger(adUnitNames);
        },
        /**
         * Refresh the current ads on the page
         */
        refresh: function () {
            instance.refresh();
        },
        /**
         * Remove one or more ad units by specifying their names
         * @param {string|string[]} adUnitNames - the name(s) of the adUnits to remove
         */
        removeAdUnits: function (adUnitNames) {
            adUnitNames = utils.stringToArray(adUnitNames);
            instance.removeAdUnitsFromPage(adUnitNames);
        },
        /**
         * Remove all the current inserted ads from the page
         */
        removeAllAds: function () {
            instance.adManager.removeAllAds();
        },
        /**
         * Completely reload the ad library and re-read the ad configuration
         */
        reload: instance.reload.bind(instance),
        events: events
    };

    var messageData = {
        sender: appSettings.globalVarName,
        message: "ready"
    };

    //noinspection JSUnresolvedFunction
    window.postMessage(JSON.stringify(messageData), '*');
    logger.info("Public API initialized on var '" + appSettings.globalVarName + "'");
};

/**
 * Initiates the ad library by reading the configuration file and starting
 * the process of placing ads on the page
 */
AdLib.prototype.init = function () {
    if (!this.applicationId) {
        logger.wtf('Could not retrieve applicationId');
        return; //Exit the application
    }

    this._initAdManager(this.applicationId);
};

/**
 * Remove all the ads from the current page and reload the configuration
 */
AdLib.prototype.reload = function () {
    this.adManager.removeAllAds();
    this.init();
};

/**
 * Creates a new instance of the ad manager and lets the manager starts its insertion
 * @private
 */
AdLib.prototype._initAdManager = function (applicationId) {
    this.adManager = new AdManager(applicationId, this.deviceDetails, this.environment);
    this.adManager.loadAds();

    this._startPathChangePolling();
};

/**
 * Starts polling window.location.path for changes and
 * refreshes the ads if a change is detected
 * @private
 */
AdLib.prototype._startPathChangePolling = function () {
    var self = this;
    setInterval(function () {
        if (window.location.pathname !== self.path) {
            //Refresh the AdLib if the Pathname has changed
            //This can be very common on single page applications using
            //The browser history API
            self.path = window.location.pathname;
            self.refresh();
        }
    }, 500);
};

/**
 * Remove the adUnits specified from the current page
 * @param {Array.<string>} adUnitNames - The names of the adUnits to remove
 */
AdLib.prototype.removeAdUnitsFromPage = function (adUnitNames) {
    this.adManager.removeAdUnits(adUnitNames);
};


/**
 * This method can be used for manually triggering a reload of the ads on the page
 *
 * For example, a single-page application does not reload the script when
 * changing the pages. The AdLib API exposed on the browser's window variable
 * Can use the refresh function to manually trigger a reload of the ads on a page
 */
AdLib.prototype.refresh = function () {
    this.adManager.refresh();
};

/**
 * Manually trigger certain ad units to be inserted on a page
 *
 * This is for adUnits with the trigger property specified
 * For example, when a dialog loads, ads in this dialog can be shown by using
 * the trigger method exposed by the AdLib API on the browser's window object
 *
 * @param {Array.<String>} unitTriggers - Array of the adUnit names to trigger
 */
AdLib.prototype.trigger = function (unitTriggers) {
    this.adManager.trigger(unitTriggers);
};


module.exports = AdLib;

},{"./ads/adManager":5,"./appSettings":8,"./device/deviceDetector":9,"./events":12,"./page":14,"./util/logger":18,"./utils":20}],3:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/15/15.
 *
 * The ads builder module takes care of building the HTML structure of teh ad
 */
var logger = require('../util/logger'),
    appSettings = require('../appSettings');

/**
 * @typedef {Object} AdMacro - The macro object defining ad macros
 * @property {string} AdMacro.macro - The macro to search for in the string
 * @property {string} AdMacro.prop - The property in the object to replace the value with
 * The macros to replace for the actual advertisement
 * @type {Array.<AdMacro>}
 */
var adMacros = [
    {
        macro: "##campaign_name##",
        prop: "campaign_name"
    },
    {
        macro: "##campaign_description##",
        prop: "campaign_description"
    },
    {
        macro: "##click_url##",
        prop: "click_url"
    },
    {
        macro: "##category_name##",
        prop: "category_name"
    },
    {
        macro: "##campaign_image_url##",
        prop: "campaign_image"
    }
];

var childTagDictionary = {
    table: "tbody",
    tbody: "tr",
    theader: "tr",
    tr: "td"
};

/**
 * Replaces macros in a string with the properties of an object
 * @param s The string to replace the macros in
 * @param macros The macros to replace the string with
 * @param obj the object to get the macro properties from
 * @returns {String} - The string with the macros replaced
 * @private
 */
function _replaceMacros(s, macros, obj) {
    var regex = null;
    for (var i = 0; i < macros.length; i++) {
        var macro = macros[i];
        regex = new RegExp(macro.macro, "g");

        s = s.replace(regex, obj[macro.prop]);
    }

    return s;
}


//////////////////////////
//Start of API
//////////////////////////

/**
 * Creates a new instance of the adBuilder
 * @param ads array of ads provided by the adsFetcher
 * @constructor
 */
var AdBuilder = function (ads) {
    this._ads = ads;
    this._uid = 0;
};

/**
 * Replaces the macros for the actual advertisement
 * @param {string} htmlString - The html template string
 * @param ad the ad to use for the adUnit
 * @returns {String} the htmlString with replaced macros
 * @private
 */
AdBuilder.prototype._replaceAdMacros = function (htmlString, ad) {
    return _replaceMacros(htmlString, adMacros, ad);
};

/**
 * Creates an actual adUnit from adUnitSettings
 * @param adUnitSettings the settings for the adUnit
 * @param {HTMLElement} adContainerElement - The HTML element of the ad container
 * @returns {Node} the HTML Node for the ad unit
 */
AdBuilder.prototype.createAdUnit = function (adUnitSettings, adContainerElement) {
    var htmlString = adUnitSettings.htmlTemplate;
    var ad = this._ads.shift();

    if (!ad) {
        //We ran out of ads
        //TODO: what do in this case?
        logger.error("Ran out of ads before all ads could be inserted");
        return null;
    }

    //Create a temporary div to wrap the innerhtml im
    var tempDiv = document.createElement(adContainerElement.tagName);
    tempDiv.innerHTML = htmlString;

    //Get the htmlTemplate string as a DOM object
    var adElement = tempDiv.firstChild;
    adElement.style.position = "relative";
    adElement.className = appSettings.adElementClassname;
    adElement.id = this._newAdElementID();

    htmlString = tempDiv.innerHTML;
    htmlString = this._replaceAdMacros(htmlString, ad);

    tempDiv = document.createElement(adContainerElement.tagName);
    tempDiv.innerHTML = htmlString;

    adElement = tempDiv.firstChild;

    return adElement;
};

/**
 * Generates a new Unique ID for an ad unit
 * @returns {string} the new uniqueID
 * @private
 */
AdBuilder.prototype._newAdElementID = function () {
    return "pocket_adUnit_" + this._uid++;
};

/**
 * Create a new child element for a tag with a certain tag name
 * @param {HTMLElement} element - The element to create a child element for
 * @returns {HTMLElement} the child element
 * @private
 */
AdBuilder.prototype._createEmptyChildElement = function (element) {
    var elementTagName = element.tagName.toLowerCase();

    var tagNameToCreate = childTagDictionary[elementTagName] || 'div'; //Simply create a div it if it is not known in the dictionary
    return document.createElement(tagNameToCreate);
};

module.exports = AdBuilder;

},{"../appSettings":8,"../util/logger":18}],4:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/19/15.
 *
 * Module that functions as a wrapper around the ad container element
 * Containing useful functions for finding the next position in an adContainer
 */
var AdContainer = function (adContainerSettings, containerElement) {
    this.containerElement = containerElement;
    this._currentIndex = adContainerSettings.startIndex;

    this.childElements = Array.prototype.slice.call(this.containerElement.children);
    var interval = adContainerSettings.interval;
    if (!interval) {
        interval = this._calculateInterval(adContainerSettings.maxNumberOfAds);
    }

    this._startIndex = adContainerSettings.startIndex;
    this._interval = interval;
};

/**
 * Calculate the interval for a unit where only a max number is set
 * @param maxNumberOfAds the max number of ads to ad to the parent container
 * @private
 */
AdContainer.prototype._calculateInterval = function (maxNumberOfAds) {
    var elements = this.childElements.slice(this._startIndex - 1);
    //TODO: maybe improve?
    return Math.round(elements.length / maxNumberOfAds);
};

/**
 * Get the next element after which an ad should be inserted
 * @returns {Node|null} - the HTML node to insert after, or null if it does not exist
 */
AdContainer.prototype.getNextElement = function () {
    if (this._currentIndex > this.childElements.length - 1) {
        return null;
    }

    var element = this.childElements[this._currentIndex];
    this._currentIndex += this._interval;
    
    return element;
};

/**
 * get the number of ads to insert in this adContainer
 * @returns {number} - the number of ads to insert
 */
AdContainer.prototype.getNumberOfAdsToInsert = function () {
    var index = this._startIndex;
    var counter = 0;

    while (this.childElements[index]) {
        counter++;
        index += this._interval;
    }

    return counter;
};

module.exports = AdContainer;

},{}],5:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/16/15.
 *
 * The AdManager module takes care of anything ads related on the page and distributes tasks to the right modules
 */
var insertAds = require('./insertAds'),
    fetchConfiguration = require('../adConfiguration/fetchConfiguration'),
    fetchAds = require('./fetchAds'),
    page = require('../page'),
    logger = require('../util/logger'),
    events = require('../events');

/**
 * Creates a new instance of the adManager
 * @param applicationId - The ID of the application to receive ads for
 * @param deviceDetails - Details about the current users' device
 * @param environment - Environment specific functions.
 * @constructor
 */
var AdManager = function (applicationId, deviceDetails, environment) {
    this.applicationId = applicationId;
    this.deviceDetails = deviceDetails;
    this.environment = environment;
    this._currentAds = [];
    this._loadingAds = [];
    this._adsWithoutImages = [];
};

/**
 * Starts the adManager to detect which ads should be inserted
 * in the current context of the page and starts the insertion
 * of these ads
 */
AdManager.prototype.loadAds = function () {
    var self = this;
    this._getAdUnitsForCurrentPage(function (adUnits) {
        for (var i = 0; i < adUnits.length; i++) {
            var adUnit = adUnits[i];
            self.getAdsForAdUnit(adUnit);
        }
    });
};

/**
 * Retrieve ads for the given ad unit
 * @param adUnit - The ad unit to retrieve ads for
 */
AdManager.prototype.getAdsForAdUnit = function (adUnit) {
    var self = this;

    page.whenReady(function () {
        fetchAds(adUnit, function (ads) {
            if (ads.length === 0) {
                logger.error('No ads retrieved from OfferEngine');
                return; //Do not continue.
            }

            self._onAdsLoaded(adUnit, ads);
        });
    });
};


/**
 * Remove all the currently inserted ads
 */
AdManager.prototype.removeAllAds = function () {
    this._removeInsertedAds(this._currentAds);
    this._currentAds = [];
};


/**
 * Manually trigger some adUnits to load
 * @param {string[]} triggers - The trigger(s) of the adUnits
 */
AdManager.prototype.trigger = function (triggers) {
    var adUnits = this.adConfig.getAdUnitsWithTrigger(triggers);

    if (adUnits.length > 0) {
        this._loadAdUnits(adUnits);
    } else {
        logger.warn("No AdUnits found with trigger(s): " + triggers.join(","));
    }
};

/**
 * Removes adUnits with given names from the page
 * @param {string[]} adUnitsToRemove - Array containing the names of the ad units to remove
 */
AdManager.prototype.removeAdUnits = function (adUnitsToRemove) {
    var currentAdsToRemove = this._currentAds.filter(function (details) {
        return adUnitsToRemove.indexOf(details.adUnit.name) > -1;
    });

    this._removeInsertedAds(currentAdsToRemove);
};

/**
 * Refreshes the ad library on the page
 */
AdManager.prototype.refresh = function () {
    this.removeAllAds();
    this.loadAds();
};

/**
 * Get the ad configuration for the current page
 * @private
 */
AdManager.prototype._getAdUnitsForCurrentPage = function (callback) {
    fetchConfiguration(this.environment, this.applicationId, function (err, adUnits) {
        if (err) {
            logger.error('Could not fetch ad configuration.');
            return;
        }

        logger.info('Received ' + adUnits.length + ' ad units to run on the current page');
        callback(adUnits);
    });
};

/**
 * Remove the given inserted ads on the page
 * @param currentAds - The current inserted ads to remove
 * @private
 */
AdManager.prototype._removeInsertedAds = function (currentAds) {
    for (var i = 0; i < currentAds.length; i++) {

        var currentAd = currentAds[i];
        for (var j = 0; j < currentAd.adElements.length; j++) {
            var adElementToRemove = currentAd.adElements[j];
            adElementToRemove.parentNode.removeChild(adElementToRemove);
        }
    }
};

/**
 * Callback that gets called when the ads are loaded from the AdProvider
 * @param {Object} adUnit - the adUnit to which the ads belong
 * @param {[]} ads - Array of ads obtained from the server
 * @private
 */
AdManager.prototype._onAdsLoaded = function (adUnit, ads) {
    var insertedAds = insertAds(adUnit, ads, this._adImageDoneLoading.bind(this));
    if (insertedAds) {
        this._currentAds.push({
            adUnit: adUnit,
            adElements: insertedAds
        });

        this._loadingAds = this._loadingAds.concat(insertedAds);
    }

    this._checkAllAdImagesDone();
};

/**
 * Callback that is executed each time the image of an ad is done loading
 * @param {HTMLElement} adElement - The element that is done loading
 * @param {boolean} hasImage - Boolean indicating whether the ad contained an image
 * @private
 */
AdManager.prototype._adImageDoneLoading = function (adElement, hasImage) {
    if (!hasImage) {
        this._adsWithoutImages.push(adElement);
    } else {
        var indexOfLoadingAd = this._loadingAds.indexOf(adElement);
        this._loadingAds.splice(indexOfLoadingAd, 1); //Remove from the loading ads array
    }

    this._checkAllAdImagesDone();
};

/**
 * Checks if all ad images are done loading and emits an event that all ads are ready
 * @private
 */
AdManager.prototype._checkAllAdImagesDone = function () {
    if ((this._adsWithoutImages.length === 0 && this._loadingAds.length === 0) || this._loadingAds.length === this._adsWithoutImages.length) {
        logger.info("All ads and images are done loading");
        var eventListeners = events.getListeners(events.events.afterAdsInserted);
        if (eventListeners && eventListeners.length) {
            for (var j = 0; j < eventListeners.length; j++) {
                eventListeners[j](this._currentAds);
            }
        }
    }
};


module.exports = AdManager;
},{"../adConfiguration/fetchConfiguration":1,"../events":12,"../page":14,"../util/logger":18,"./fetchAds":6,"./insertAds":7}],6:[function(require,module,exports){
/**
 * Created by niek on 13/04/16.
 *
 * This module provides ads to the library
 */
var ajax = require('../util/ajax');
var page = require('../page');
var logger = require('../util/logger');
var appSettings = require('../appSettings');

/**
 * Get the number of ads this unit needs to place all the ads on the page
 * @param adUnit The ad unit to get the required number of ads for
 * @returns {number} the number of required ads
 * @private
 */
function _getRequiredAdCountForAdUnit(adUnit) {
    var adContainers = page.getAdContainers(adUnit);

    if (!adContainers.length) {
        return 0;
    }

    var numberOfAdsToInsert = 0;
    for (var i = 0; i < adContainers.length; i++) {
        var adContainer = adContainers[i];
        numberOfAdsToInsert += adContainer.getNumberOfAdsToInsert();
    }

    return numberOfAdsToInsert;
}

/**
 * Request ads from the offerEngine
 * @param adUnit - The ad Unit that is requesting ads
 * @param callback - The callback to execute containing the ads
 */
function requestAds(adUnit, callback) {
    var limit = _getRequiredAdCountForAdUnit(adUnit);
    var token = page.getToken();

    var requestQuery = {
        "output": "json",
        "placement_key": adUnit.placementKey,
        "limit": limit,
        "token": token,
        "auto_device": 1
    };

    //noinspection JSUnresolvedVariable
    if (typeof ADLIB_OVERRIDES !== "undefined" && ADLIB_OVERRIDES.formFactor) {
        if (ADLIB_OVERRIDES.platform && ADLIB_OVERRIDES.fullDeviceName && ADLIB_OVERRIDES.version) {
            delete requestQuery.auto_device;
            requestQuery.os = ADLIB_OVERRIDES.platform;
            requestQuery.model = ADLIB_OVERRIDES.fullDeviceName;
            requestQuery.version = ADLIB_OVERRIDES.version;
        }
    }

    ajax.get({
        url: appSettings.adApiBaseUrl,
        query: requestQuery,
        success: function (data) {
            if (data.length !== limit) {
                logger.warn("Tried to fetch " + limit + " ads, but only received " + data.length);
            }

            callback(data);
        },
        error: function (e) {
            logger.wtf('An error occurred trying to fetch ads');
        }
    });
}

module.exports = requestAds;
},{"../appSettings":8,"../page":14,"../util/ajax":15,"../util/logger":18}],7:[function(require,module,exports){
/**
 * Created by niek on 13/04/16.
 * This module takes care of the ad insertion for a given ad unit
 */
var page = require('../page');
var AdBuilder = require('./adBuilder');
var deviceDetector = require('../device/deviceDetector');
var logger = require('../util/logger');

/**
 * Insert advertisements for the given ad unit on the page
 * @param adUnit - The ad unit to insert advertisements for
 * @param ads - Array of ads retrieved from OfferEngine
 * @param adLoadedCallback - Callback to execute when the ads are fully loaded
 * @returns {Array}
 */
function insertAds(adUnit, ads, adLoadedCallback) {
    var adContainers = page.getAdContainers(adUnit);

    if (!adContainers.length) {
        logger.error("No ad containers could be found. stopping insertion for adUnit " + adUnit.name);
        return []; //Ad can't be inserted
    }
    
    var adBuilder = new AdBuilder(ads);

    var beforeElement;
    var insertedAdElements = [];
    for (var i = 0; i < adContainers.length; i++) {
        var adContainer = adContainers[i];
        while ((beforeElement = adContainer.getNextElement()) !== null) {
            var adToInsert = adBuilder.createAdUnit(adUnit, adContainer.containerElement);

            if (adToInsert === null) {
                //we ran out of ads.
                break;
            }

            insertedAdElements.push(adToInsert);
            beforeElement.parentNode.insertBefore(adToInsert, beforeElement.nextSibling);

            // var elementDisplay = adToInsert.style.display || "block";
            //TODO: Why are we defaulting to block here?
            // adToInsert.style.display = elementDisplay;
            handleImageLoad(adToInsert, adLoadedCallback);
        }
    }

    return insertedAdElements;
}

/**
 * Add an event handler to the onload of ad images.
 * @param adElement - The HTML element of the advertisement
 * @param adLoadedCallback - Callback to execute when ads are loaded
 */
function handleImageLoad(adElement, adLoadedCallback) {
    var adImage = adElement.querySelector("img");
    if (adImage) {
        (function (adToInsert, adImage) {
            adImage.onload = function () {
                adLoadedCallback(adToInsert, true);
            };
        })(adElement, adImage);
    } else {
        adLoadedCallback(adElement, false);
    }
}

module.exports = insertAds;
},{"../device/deviceDetector":9,"../page":14,"../util/logger":18,"./adBuilder":3}],8:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/5/15.
 * This module contains library wide debug settings
 * A module that exposes the app settings
 */
var enumerations = require("./util/enumerations");

/**
 * Exports the appSettings
 */
module.exports = {
    configFileName: "/adconfig.json",
    isDebug: false,
    logLevel: enumerations.logLevel.debug,
    adApiBaseUrl: " http://offerwall.12trackway.com/ow.php",
    globalVarName: "pocket_native_ads",
    xDomainStorageURL: " http://offerwall.12trackway.com/xDomainStorage.html",
    tokenCookieKey: "pm_offerwall",
    loggerVar: "__adlibLog",
    defaultSmartPhoneWidth: 375,
    defaultTabletWidth: 768,
    configurationsApiUrl: 'http://offerwall.12trackway.com/cf.php',
    applicationIdAttribute: 'data-application-id',
    adElementClassname: 'pm_native_ad_unit',
    displaySettings: {
        mobile: {
            minWidth: 0,
            maxWidth: 415
        },
        tablet: {
            minWidth: 415,
            maxWidth: 1024
        }
    }
};

},{"./util/enumerations":17}],9:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/9/15.
 *
 * This module contains functionality for detecting details about a device
 */
var appSettings = require('../appSettings'),
    DeviceEnumerations = require('../device/enumerations');

/**
 * Check if the platform the user is currently visiting the page with is valid for
 * the ad library to run
 * @returns {boolean}
 */
function isValidPlatform() {
    if (typeof ADLIB_OVERRIDES !== "undefined" && ADLIB_OVERRIDES.platform) {
        return true; //If a platform override is set, it's always valid
    }
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Detects the device form factor based on the ViewPort and the deviceWidths in AppSettings
 * The test_old is done based on the viewport, because it is already validated that a device is Android or iOS
 * @returns {*} the form factor of the device
 * @private
 */
function detectFormFactor() {
    var viewPortWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);

    var displaySettings = appSettings.displaySettings; //convenience variable
    var formFactor;

    if (viewPortWidth >= displaySettings.mobile.minWidth && viewPortWidth <= displaySettings.mobile.maxWidth) {
        formFactor = DeviceEnumerations.formFactor.smartPhone;
    } else if (viewPortWidth >= displaySettings.tablet.minWidth && viewPortWidth <= displaySettings.tablet.maxWidth) {
        formFactor = DeviceEnumerations.formFactor.tablet;
    } else {
        formFactor = DeviceEnumerations.formFactor.desktop;
    }

    return formFactor;
}

var cache = null;
module.exports = {
    getDeviceDetails: function() {
        if(cache) return cache;

        var formFactor = detectFormFactor();
        if (typeof ADLIB_OVERRIDES !== "undefined" && ADLIB_OVERRIDES.formFactor) {
                formFactor = ADLIB_OVERRIDES.formFactor;
        }
        cache = {
            formFactor: formFactor,
            isValidPlatform: isValidPlatform()
        };

        return cache;
    }
};



//NOTE: We are not using platform detection for anything right now as the OfferEngine does automatic device detection,
// but we might need it later, so it's commented out. (comments aren't included in minified build)

// /**
//  * Detects the platform of the device
//  * @returns {string} the platform of the device
//  */
// DeviceDetector.prototype.detectPlatform = function () {
//     if (this.platform) {
//         return this.platform;
//     }
//
//     var platform;
//     if (/Android/i.test_old(this.userAgentString)) {
//         platform = DeviceEnumerations.platform.android;
//     } else if (/iPhone|iPad|iPod/i.test_old(this.userAgentString)) {
//         platform = DeviceEnumerations.platform.iOS;
//     } else {
//         platform = DeviceEnumerations.platform.other;
//     }
//
//
//     this.platform = platform;
//     return this.platform;
// };


},{"../appSettings":8,"../device/enumerations":10}],10:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/9/15.
 *
 * Module contains device related enumerations
 */
var enumerations = {};
enumerations.formFactor = {
    desktop: "desktop",
    app: "app",
    tablet: "tablet",
    smartPhone: "mobile"
};

enumerations.platform = {
    android: "Android",
    iOS: "iOS",
    other: "other"
};

module.exports = enumerations;

},{}],11:[function(require,module,exports){
var resolveTokenFunction = require('../util/resolveToken');

module.exports = {
    getPathname: function () {
        return window.location.pathname;
    },
    start: function() {
        callback(null);
    },
    resolveToken: resolveTokenFunction
};
},{"../util/resolveToken":19}],12:[function(require,module,exports){
/**
 * Created by NiekKruse on 1/20/16.
 *
 * Module for adding and removing event listeners
 */

/**
 * @enum {string}
 */
var events = {
    afterAdsInserted: "afterAdsInserted"
};
var listeners = {};

/**
 * Check if the event passed is valid
 * @param {string} eventName - Name of the event
 */
function checkEventValid(eventName) {
    if (!events.hasOwnProperty(eventName)) {
        throw eventName + " is not a valid event listener";
    }
}

/**
 * Add a new event listener
 * @param {events} event - The name of the event listener to add an event for
 * @param {function} callback - The callback to invoke when the event is called
 */
function addListener(event, callback) {
    checkEventValid(event);

    if (listeners[event]) {
        listeners[event].push(callback);
    } else {
        listeners[event] = [callback];
    }
}

/**
 * Remove a certain event listener
 * @param {events} event - The name of the event to listen to
 * @param {function} eventHandler - The eventHandler that is bound to this listener and should be removed
 */
function removeListener(event, eventHandler) {
    checkEventValid(event);

    if (listeners[event] && listeners[event].length) {
        var indexOfListener = listeners[event].indexOf(eventHandler);
        if (indexOfListener > -1) {
            listeners[event].splice(indexOfListener, 1);
        }
    }
}

/**
 * Get the event handlers for a certain event
 * @param {events} eventName - The name of the event to get listeners for
 */
function getListeners(eventName) {
    return listeners[eventName];
}

module.exports = {
    events: events,
    addListener: addListener,
    removeListener: removeListener,
    getListeners: getListeners
};
},{}],13:[function(require,module,exports){
/**
 * Main entry point for the ad library.
 */
var deviceDetails = require('./device/deviceDetector').getDeviceDetails(),
    environment = require('./env/environment'),
    AdLib = require('./adLib'),
    logger = require('./util/logger'),
    appSettings = require("./appSettings");

var isInitialized = false;

window[appSettings.globalVarName] = {ready: false};

function initAdLib(options) {
    var adLib = new AdLib(environment, options);
    adLib.init();
    isInitialized = true;
    window[appSettings.globalVarName].init = null;
}

function getApplicationId() {
    var applicationId = null;
    if (typeof window.ADLIB_OVERRIDES !== "undefined" && window.ADLIB_OVERRIDES.applicationId) {
        applicationId = window.ADLIB_OVERRIDES.applicationId;
    }
    var scriptTag = document.querySelector("script[" + appSettings.applicationIdAttribute + "]");
    if (scriptTag) {
        applicationId = scriptTag.getAttribute(appSettings.applicationIdAttribute);
    }

    return applicationId;
}

if (!isInitialized && deviceDetails.isValidPlatform) {
    logger.info('Initializing native ads library');
    var applicationId = getApplicationId();
    if (applicationId) {
        initAdLib({
            applicationId: applicationId
        });
    } else {
        window[appSettings.globalVarName].init = initAdLib;
    }
}
},{"./adLib":2,"./appSettings":8,"./device/deviceDetector":9,"./env/environment":11,"./util/logger":18}],14:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/14/15.
 * Module that contains information about the current page
 * @module page
 */
var logger = require("./util/logger"),
    utils = require("./utils"),
    AdContainer = require("./ads/adContainer");

/**
 * Cached version of the token
 * @type {string|null}
 */
var token = null;
var isPreloadingToken = false;

//Keep an array containing callbacks that should fire when the page is ready
var callbacksOnReady = [];

/**
 * Evaluates xPath on a page
 * @param {string} xPathString - The Xpath string to evaluate
 * @returns {Array.<HTMLElement>} - An array of the found HTML elements
 */
function xPath(xPathString) {
    var xResult = document.evaluate(xPathString, document, null, 0, null);
    var xNodes = [];
    var xRes = xResult.iterateNext();
    while (xRes) {
        xNodes.push(xRes);
        xRes = xResult.iterateNext();
    }

    return xNodes;
}


/**
 * Check if the entire page is ready
 * @returns {boolean} - True if the page is ready, false if it isn't.
 */
function isReady() {
    var domReady = document.readyState !== 'loading';
    var tokenReady = token !== null;

    return (domReady && tokenReady);
}

/**
 * Execute all the functions that are waiting for the page to finish loading
 */
function execWaitReadyFunctions() {
    if (isReady()) {
        logger.info('Page is ready. Executing ' + callbacksOnReady.length + ' functions that are waiting.');
        for (var i = 0; i < callbacksOnReady.length; i++) {
            var callback = callbacksOnReady[i];
            callback();
        }
    }
}

function preloadToken (environment) {
    isPreloadingToken = true;
    environment.resolveToken(function (userToken) {
        token = userToken;
        logger.info('User tracking token resolved');
        execWaitReadyFunctions();
    });
}

/**
 * Returns a promise that resolves when the page is ready
 * @param funcToExecute - The function to execute when the page is loaded
 */
function whenReady(funcToExecute) {
    if (isReady()) {
        logger.info('Page is already loaded, instantly executing!');
        funcToExecute();
        return;
    }

    logger.info('Waiting for page to be ready');
    callbacksOnReady.push(funcToExecute);
}

module.exports = {
    /**
     * Check whether the page has responsive design
     * @returns {boolean} indicating whether page is responsive or not
     */
    isResponsive: function () {
        var viewPortMetaTag = document.querySelector("meta[name=viewport]");
        return (viewPortMetaTag !== null);
    },
    /**
     * Gets the adcontainers on the page from the container xPath
     * @param adUnitSettings the settings for the adUnit to get the container of
     * @returns {Array.<Object>} the AdContainer object or null if not found
     */
    getAdContainers: function (adUnitSettings) {
        var containers = adUnitSettings.containers;

        var adContainers = [];

        for (var i = 0; i < containers.length; i++) {
            var container = containers[i];

            var containerXPath = container.xPath;
            var adContainerElements = xPath(containerXPath);

            if (!adContainerElements.length) {
                logger.warn("Ad container with xPath: \"" + containerXPath + "\" could not be found on page");
                continue;
            }

            if (adContainerElements.length > 1) {
                logger.warn("Ad container with xPath:  \"" + containerXPath + "\" has multiple matches");
            }

            adContainers.push(new AdContainer(container, adContainerElements[0]));
        }

        return adContainers;
    },
    /**
     * remove an element from the dom
     * @param domNode the element to remove
     */
    removeElement: function (domNode) {
        domNode.parentElement.removeChild(domNode);
    },
    xPath: xPath,
    /**
     * Get the OfferEngine token
     */
    getToken: function () {
        return token;
    },
    preloadToken: preloadToken,
    addDomReadyListener: function(environment) {
        document.addEventListener('DOMContentLoaded', function () {
            logger.info('DOM is ready');
            if(!token && !isPreloadingToken) {
                logger.info('DOM ready, loading token');
                preloadToken(environment);
                return; //We don't have to check if there's functions waiting, cause the token is only just being preloaded
            }
            execWaitReadyFunctions();
        });
    },
    whenReady: whenReady
};
},{"./ads/adContainer":4,"./util/logger":18,"./utils":20}],15:[function(require,module,exports){
/**
 * Created by NiekKruse on 11/12/15.
 * Utility module containing helper functions for ajax requests
 *
 */
function appendQueryStringOptions(requestUrl, queryStringOptions) {
    requestUrl += "?";
    for (var prop in queryStringOptions) {
        if (queryStringOptions.hasOwnProperty(prop)) {
            requestUrl += prop + "=" + queryStringOptions[prop] + "&";
        }
    }

    //Remove the last & from the string
    requestUrl = requestUrl.substr(0, requestUrl.length - 1);
    return requestUrl;
}

module.exports = {
    /**
     * @callback ajaxSuccessCallback - The callback to invoke when the Ajax call is successful
     * @param {Object} - The data received from the Ajax call
     */

    /**
     * @callback ajaxErrorCallback - The callback to invoke when the Ajax call returns an error
     * @param {Object} - The error object
     */

    /**
     * @typedef {Object} AjaxOptions - The request options
     * @property {string} url - The URL of the get request
     * @property {Object.<string, string>} [query] - The options to append to the query string
     * @property {ajaxSuccessCallback} success - The callback to invoke when the ajax call succeeds
     * @property {ajaxErrorCallback} error - The callback to invoke when the ajax call returns an error
     */

    /**
     * Do a GET request
     * @param {AjaxOptions} options - The options
     */
    get: function (options) {
        var request = new XMLHttpRequest();

        var requestUrl = appendQueryStringOptions(options.url, options.query);
        request.open('get', requestUrl);

        request.onload = function () {
            options.success(JSON.parse(request.responseText));
        };

        request.onerror = function (progressEvent) {
            options.error(progressEvent);
        };

        request.send();
    }
};
},{}],16:[function(require,module,exports){
/**
 * Created by NiekKruse on 11/4/15.
 *
 * Module for easily reading / writing to browsers' LocalStorage across domains
 *
 * This works in the following way:
 *
 * 1. An iFrame is loaded on the current (publisher's) page.
 * 2. The contents of this iFrame are hosted on the same server as the offerWall
 * 3. The page of the iFrame can receive messages through the postMessage api
 * 4. When the iFrame receives a message it understands, it gets the required data from the localStorage API
 *    Because the iFrame is hosted on the OfferWall server, the localStorage contents will be the same
 * 5. The iFrame sends back a message containing the requested details
 * 6. The CrossDomainStorage module (this one) invokes the callback specified in the request
 */
var appSettings = require('../appSettings'),
    logger = require('../util/logger');

var MESSAGE_NAMESPACE = "xdomain-localstorage-message";

function logCallInitFirst() {
    logger.wtf("CrossDomainStorage not initialized yet. Call .init() first.");
}

/**
 * Create a new instance of the CrossDomainStorage object
 * @constructor
 */
var XDomainLocalStorage = function () {
    this.isReady = false;
    this._requestID = -1;
    this._iframe = null;
    this._initCallback = null;
    this._requests = {};

    this._options = {
        iframeID: "pm-lib-iframe"
    };
};

/**
 * Function that is called when a message is received from the iFrame
 * @param event - The event details of the received message
 * @private
 */
XDomainLocalStorage.prototype._messageReceived = function (event) {
    var data;
    try {
        data = JSON.parse(event.data);
    } catch (e) {
        //Probably received a message that didn't belong to us, do nothing.
        return;
    }

    if (data && data.namespace === MESSAGE_NAMESPACE) {
        //The message belongs to us
        if (data.id === "iframe-ready") {
            //Call the init callback
            this.isReady = true;
            this._initCallback();
        } else {
            this._processResponse(data);
        }
    }
};

/**
 * Process a response from the iFrame by invoking the correct callback
 * @param {{}} messageData - the data received from the iFrame message
 * @private
 */
XDomainLocalStorage.prototype._processResponse = function (messageData) {
    if (this._requests[messageData.id]) { //Check if we did in fact expect this message first
        this._requests[messageData.id](messageData);
        delete this._requests[messageData.id];
    }
};

/**
 * Builds a message and sends it to the loaded iFrame
 * @param {string} action - the action to invoke
 * @param {string} key - the key of the localStorage item
 * @param {string} value - The value of the localStorage item
 * @param {function} callback - the callback to invoke when the operation is finished
 * @private
 */
XDomainLocalStorage.prototype._createMessage = function (action, key, value, callback) {
    this._requestID++;
    this._requests[this._requestID] = callback;

    var data = {
        namespace: MESSAGE_NAMESPACE,
        id: this._requestID,
        action: action,
        key: key,
        value: value
    };

    this._iframe.contentWindow.postMessage(JSON.stringify(data), '*');
};

/**
 * Initialize CrossDomainLocalStorage by loading the iFrame
 * @param loadedCallback the callback to invoke when the iFrame is ready
 */
XDomainLocalStorage.prototype.init = function (loadedCallback) {
    if (this.isReady) {
        //We are already initialized and are ready to receive messages. Just directly invoke the callback
        loadedCallback();
    }

    this._initCallback = loadedCallback;
    if (window.addEventListener) {
        window.addEventListener('message', this._messageReceived.bind(this), false);
    } else {
        window.attachEvent('onMessage', this._messageReceived);
    }

    this.isReady = true;
    var temp = document.createElement("div");
    temp.innerHTML = '<iframe id="' + this._options.iframeID + '" src="' + appSettings.xDomainStorageURL + '" style="display: none;"></iframe>';

    document.body.appendChild(temp);

    this._iframe = document.getElementById(this._options.iframeID);
};

/**
 * Set an item in the local storage hosted on another domain
 * @param {string} key - key the key of the item
 * @param {string} value - value the value of the item
 * @param {function} callback - the callback to invoke when the operation is finished
 */
XDomainLocalStorage.prototype.setItem = function (key, value, callback) {
    if (!this.isReady) {
        logCallInitFirst();
        return;
    }

    this._createMessage("setItem", key, value, callback);
};

/**
 * Gets an item from the localStorage hosted on another domain
 * @param {string} key - the key of the item to get
 * @param {function} callback - the callback to invoke when the operation is finished
 */
XDomainLocalStorage.prototype.getItem = function (key, callback) {
    if (!this.isReady) {
        logCallInitFirst();
        return;
    }

    this._createMessage("getItem", key, null, callback);
};

/**
 * Check if localStorage api is available
 * @returns {boolean} - Boolean indicating whether localStorage can be used
 */
XDomainLocalStorage.prototype.isAvailable = function () {
    try {
        var storage = window.localStorage;

        var test = '__storage_local_test__';
        storage.setItem(test, test);
        storage.removeItem(test);
        return true;
    } catch (e) {
        return false;
    }
};


module.exports = new XDomainLocalStorage(); //A new instance.


},{"../appSettings":8,"../util/logger":18}],17:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/16/15.
 * Contains app wide enumerations
 */
module.exports = {
    /**
     * The enum for the logLevel
     * @readonly
     * @enum {number}
     */
    logLevel: {
        off: 0,
        debug: 1,
        warn: 2,
        error: 3
    },
    /**
     * The enum for the logType
     * @readonly
     * @enum {string}
     */
    logType: {
        info: "INFO",
        warning: "WARNING",
        error: "ERROR",
        wtf: "FATAL"
    }
};
},{}],18:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/14/15.
 * Helper module for logging purposes
 * @module util/logger
 */
var appSettings = require('../appSettings'),
    enumerations = require('../util/enumerations');

function init() {
    //Check if the logger exists
    if (!window[appSettings.loggerVar]) {
        var Logger = function () {
            this.logs = [];
        };

        Logger.prototype.json = function () {
            return JSON.stringify(this.logs);
        };

        Logger.prototype.print = function () {
            var string = "";

            var consoleRef = console;
            for (var i = 0; i < this.logs.length; i++) {
                var log = this.logs[i];

                consoleRef.log(toFriendlyString(log));
            }

            return string;
        };

        window[appSettings.loggerVar] = new Logger();
    }
}

/**
 * Create a friendly string out of a log entry
 * @param logEntry - The LogEntry to create a friendly string for
 * @returns {string} - the friendly string of the LogEntry
 */
function toFriendlyString(logEntry) {
    return "[PM_Native_Ads " + logEntry.type + "] " + logEntry.time + " - " + logEntry.text;
}

/**
 * Push a logEntry to the array of logs and output it to the console
 * @param logEntry The logEntry to process
 */
function pushLogEntry(logEntry) {
    var logger = window[appSettings.loggerVar];
    if (logger) {
        logger.logs.push(logEntry);

        if (window.console) {
            if (typeof console.error === "function" && typeof console.warn === "function") {
                switch (logEntry.type) {
                    case enumerations.logType.wtf:
                        console.error(toFriendlyString(logEntry));
                        break;
                    case enumerations.logType.error:
                        if (appSettings.logLevel <= enumerations.logLevel.error && appSettings.logLevel > enumerations.logLevel.off) {
                            console.error(toFriendlyString(logEntry));
                        }
                        break;
                    case enumerations.logType.warning:
                        if (appSettings.logLevel <= enumerations.logLevel.warn && appSettings.logLevel > enumerations.logLevel.off) {
                            console.warn(toFriendlyString(logEntry));
                        }
                        break;
                    default:
                        if (appSettings.logLevel <= enumerations.logLevel.debug && appSettings.logLevel > enumerations.logLevel.off) {
                            console.log(toFriendlyString(logEntry));
                            break;
                        }
                }

            } else {
                console.log(toFriendlyString(logEntry));
            }
        }
    }
}

/**
 * Get the current time as a string
 * @returns {string} - the current time in a hh:mm:ss string
 */
function getCurrentTimeString() {
    var today = new Date();
    var hh = today.getHours();
    var mm = today.getMinutes(); //January is 0
    var ss = today.getSeconds();
    var ms = today.getMilliseconds();

    if (hh < 10) {
        hh = '0' + hh;
    }

    if (mm < 10) {
        mm = '0' + mm;
    }

    if (ss < 10) {
        ss = '0' + ss;
    }

    if (ms < 10) {
        ms = '0' + ms;
    }

    return hh + ":" + mm + ":" + ss + ":" + ms;
}

/**
 * @typedef {Object} LogEntry - A logging entry object
 * @param {string} time - The time of the log as a string
 * @param {text} text - The text of the log
 */

/**
 * Create a new LogEntry object
 * @param {string} logType - the type of log
 * @param {string} logText - The text of the log
 */
function createLogEntry(logType, logText) {
    var logger = window[appSettings.loggerVar];
    if(!logger) {
        init(); //Always initialize on our first log entry
    }

    var log = {
        type: logType,
        time: getCurrentTimeString(),
        text: logText
    };

    pushLogEntry(log);
}


module.exports = {
    /**
     * Creates a new info log
     * @param {string} logText - the text the log should contain
     */
    info: function (logText) {
        createLogEntry(enumerations.logType.info, logText);
    },
    /**
     * Creates a new warning log
     * @param {string} logText - the text the log should contain
     */
    warn: function (logText) {
        createLogEntry(enumerations.logType.warning, logText);
    },
    /**
     * Creates a new error log
     * @param {string} logText - the text the log should contain
     */
    error: function (logText) {
        createLogEntry(enumerations.logType.error, logText);
    },
    /**
     * Creates a new WTF (What a terrible failure) log
     * These should never occur in the application
     * Will always be outputted even if the logLevel is 0
     * @param logText
     */
    wtf: function (logText) {
        createLogEntry(enumerations.logType.wtf, logText);
    }
};

},{"../appSettings":8,"../util/enumerations":17}],19:[function(require,module,exports){
var crossDomainStorage = require('./crossDomainStorage');
var logger = require('./logger');
var utils = require('../utils');
var appSettings = require('../appSettings');

/**
 * Resolve the token for the user visiting the page
 * @param callback - The callback that is executed when the token is resolved
 */
function resolveToken(callback) {
    var crossDomainStorageAvailable = crossDomainStorage.isAvailable();
    logger.info('Resolving token from OfferEngine');

    if (crossDomainStorageAvailable) {
        initXDomainStorage(function () {
            crossDomainStorage.getItem(appSettings.tokenCookieKey, function (data) {
                if (data.value) {
                    logger.info('Retrieved existing token: ' + data.value);
                    callback(data.value);
                } else {
                    setCrossDomainToken(callback);
                }
            });
        });
    } else {
        // If there is no cross domain storage, we just generate a random token.
        // In reality, cross domain storage will be available on pretty much all devices
        // Because they all support localStorage now
        var token = utils.generateToken();
        callback(token);
    }
}

/**
 * @param {xDomainSetTokenCallback} callback - The callback to invoke when the token is set
 */
function setCrossDomainToken(callback) {
    var token = utils.generateToken();
    crossDomainStorage.setItem(appSettings.tokenCookieKey, token, function (data) {
        logger.info('Retrieved new token: ' + token);
        callback(token);
    });
}

/**
 * Initialize the cross domain storage module
 * @callback xDomainStorageReadyCallback - The callback that is invoked when the xDomainStorage is ready
 * @param {xDomainStorageReadyCallback} callback - The callback to invoke when the module is ready
 */
function initXDomainStorage(callback) {
    if (crossDomainStorage.isReady) {
        callback();
    } else {
        crossDomainStorage.init(callback);
    }
}

module.exports = resolveToken;
},{"../appSettings":8,"../utils":20,"./crossDomainStorage":16,"./logger":18}],20:[function(require,module,exports){
/**
 * Created by NiekKruse on 10/5/15.
 *
 * This module contains Utility functions that can be used throughout the project.
 */

/**
 * Object containing utility functions
 */
var utils = {};

/**
 * Replaces macros in a string with actual values
 * @param {string} strToFormat - The string to format
 * @returns {string} the formatted string
 */
utils.formatString = function (strToFormat) {
    var s = strToFormat;
    for (var i = 0; i < arguments.length - 1; i++) {
        var reg = new RegExp("\\{" + i + "\\}", "gm");
        s = s.replace(reg, arguments[i + 1]);
    }

    return s;
};

/**
 * Converts a string to a string array if the passed parameter is a string.
 * If the passed parameter is already a string array, the function will return it.
 * @param {string|string[]} stringOrArray - The string to convert to an array
 * @returns {Array.<string>} - The string array
 */
utils.stringToArray = function (stringOrArray) {
    if (Array.isArray(stringOrArray))
        return stringOrArray;

    if (typeof stringOrArray === 'string' || stringOrArray instanceof String) {
        //Fix into array
        stringOrArray = [stringOrArray];
    } else {
        throw stringOrArray.toString() + " is not a valid string or string array";
    }

    return stringOrArray;
};

/**
 * Generate a random token for the offerwall
 * TODO: might need some improvement
 * @returns {string} - A unique user token
 */
utils.generateToken = function () {
    var prefix = "offerengine_";
    var now = Date.now();
    var random = Math.random().toString(36).substring(7);
    return prefix + now + random;
};

module.exports = utils;

},{}]},{},[13])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYWRDb25maWd1cmF0aW9uL2ZldGNoQ29uZmlndXJhdGlvbi5qcyIsInNyYy9hZExpYi5qcyIsInNyYy9hZHMvYWRCdWlsZGVyLmpzIiwic3JjL2Fkcy9hZENvbnRhaW5lci5qcyIsInNyYy9hZHMvYWRNYW5hZ2VyLmpzIiwic3JjL2Fkcy9mZXRjaEFkcy5qcyIsInNyYy9hZHMvaW5zZXJ0QWRzLmpzIiwic3JjL2FwcFNldHRpbmdzLmpzIiwic3JjL2RldmljZS9kZXZpY2VEZXRlY3Rvci5qcyIsInNyYy9kZXZpY2UvZW51bWVyYXRpb25zLmpzIiwic3JjL2Vudi9lbnZpcm9ubWVudC5qcyIsInNyYy9ldmVudHMuanMiLCJzcmMvbWFpbi5qcyIsInNyYy9wYWdlLmpzIiwic3JjL3V0aWwvYWpheC5qcyIsInNyYy91dGlsL2Nyb3NzRG9tYWluU3RvcmFnZS5qcyIsInNyYy91dGlsL2VudW1lcmF0aW9ucy5qcyIsInNyYy91dGlsL2xvZ2dlci5qcyIsInNyYy91dGlsL3Jlc29sdmVUb2tlbi5qcyIsInNyYy91dGlscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaE1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0tBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBDcmVhdGVkIGJ5IG5pZWsgb24gMTMvMDQvMTYuXG4gKiBUaGlzIG1vZHVsZSBmZXRjaGVzIHRoZSBhZCBjb25maWd1cmF0aW9uIGZyb20gdGhlIE9mZmVyRW5naW5lIEFQSVxuICovXG52YXIgbG9nZ2VyID0gcmVxdWlyZSgnLi4vdXRpbC9sb2dnZXInKTtcbnZhciBhamF4ID0gcmVxdWlyZSgnLi4vdXRpbC9hamF4Jyk7XG52YXIgYXBwU2V0dGluZ3MgPSByZXF1aXJlKCcuLi9hcHBTZXR0aW5ncycpO1xudmFyIGRldmljZURldGVjdG9yID0gcmVxdWlyZSgnLi4vZGV2aWNlL2RldmljZURldGVjdG9yJyk7XG5cbi8qKlxuICogRmV0Y2ggdGhlIGFkIGNvbmZpZ3VyYXRpb25zIHRvIGxvYWQgb24gdGhlIGN1cnJlbnQgcGFnZSBmcm9tIHRoZSBzZXJ2ZXJcbiAqIEBwYXJhbSBlbnZpcm9ubWVudCAtIFRoZSBlbnZpcm9ubWVudCBzcGVjaWZpYyBpbXBsZW1lbnRhdGlvbnNcbiAqIEBwYXJhbSBhcHBsaWNhdGlvbklkIC0gVGhlIGFwcGxpY2F0aW9uSWQgdG8gZmV0Y2ggYWQgY29uZmlndXJhdGlvbnMgZm9yXG4gKiBAcGFyYW0gY2FsbGJhY2sgLSBUaGUgY2FsbGJhY2sgdG8gZXhlY3V0ZSB3aGVuIHRoZSBjb25maWd1cmF0aW9ucyBhcmUgcmV0cmlldmVkXG4gKi9cbmZ1bmN0aW9uIGZldGNoQ29uZmlndXJhdGlvbihlbnZpcm9ubWVudCwgYXBwbGljYXRpb25JZCwgY2FsbGJhY2spIHtcbiAgICBpZighYXBwbGljYXRpb25JZCkge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ05vIGFwcGxpY2F0aW9uIElEIHNwZWNpZmllZCcpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gV2UgYWxsb3cgYW4gb3ZlcnJpZGUgdG8gc3BlY2lmeSB0aGUgYWQgY29uZmlndXJhdGlvbnMgZGlyZWN0bHkgaW4gamF2YXNjcmlwdCwgcmF0aGVyIHRoYW5cbiAgICAvLyBIYXZpbmcgdG8gZmV0Y2ggaXQgZnJvbSB0aGUgc2VydmVyXG4gICAgaWYod2luZG93LkFETElCX09WRVJSSURFUyAmJiB3aW5kb3cuQURMSUJfT1ZFUlJJREVTLmFkQ29uZmlndXJhdGlvbnMpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgd2luZG93LkFETElCX09WRVJSSURFUy5hZENvbmZpZ3VyYXRpb25zKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBkZXZpY2VEZXRhaWxzID0gZGV2aWNlRGV0ZWN0b3IuZ2V0RGV2aWNlRGV0YWlscygpO1xuXG4gICAgdmFyIHBhdGhuYW1lID0gZW52aXJvbm1lbnQuZ2V0UGF0aG5hbWUoKTtcbiAgICB2YXIgZm9ybUZhY3RvciA9IGRldmljZURldGFpbHMuZm9ybUZhY3RvcjtcblxuICAgIHZhciByZXF1ZXN0VXJsID0gYXBwU2V0dGluZ3MuY29uZmlndXJhdGlvbnNBcGlVcmw7XG4gICAgdmFyIHF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICBwYXRoOiBwYXRobmFtZSxcbiAgICAgICAgZGV2aWNlOiBmb3JtRmFjdG9yLFxuICAgICAgICBcImFwcGxpY2F0aW9uX2lkXCI6YXBwbGljYXRpb25JZFxuICAgIH07XG5cbiAgICBhamF4LmdldCh7XG4gICAgICAgIHVybDogcmVxdWVzdFVybCxcbiAgICAgICAgcXVlcnk6IHF1ZXJ5UGFyYW1zLFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0sXG4gICAgICAgIGVycm9yOiBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnIsIG51bGwpO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmV0Y2hDb25maWd1cmF0aW9uO1xuIiwiLyoqXG4gKiBUaGUgbWFpbiBBZExpYnJhcnkgbW9kdWxlXG4gKi9cbnZhciBhcHBTZXR0aW5ncyA9IHJlcXVpcmUoJy4vYXBwU2V0dGluZ3MnKSxcbiAgICBkZXZpY2VEZXRlY3RvciA9IHJlcXVpcmUoJy4vZGV2aWNlL2RldmljZURldGVjdG9yJyksXG4gICAgbG9nZ2VyID0gcmVxdWlyZSgnLi91dGlsL2xvZ2dlcicpLFxuICAgIHBhZ2UgPSByZXF1aXJlKCcuL3BhZ2UnKSxcbiAgICBBZE1hbmFnZXIgPSByZXF1aXJlKCcuL2Fkcy9hZE1hbmFnZXInKSxcbiAgICB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBldmVudHMgPSByZXF1aXJlKCcuL2V2ZW50cycpO1xuXG4vKipcbiAqIENvbnN0cnVjdG9yIHRoYXQgY3JlYXRlcyBhbiBpbnN0YW5jZSBvZiB0aGUgQWRMaWJyYXJ5IG9iamVjdFxuICogQHBhcmFtIGVudmlyb25tZW50IC0gVGhlIGVudmlyb25tZW50IG9iamVjdCBjb250YWluaW5nIGVudmlyb25tZW50IHNwZWNpZmljIGZ1bmN0aW9uc1xuICogQHBhcmFtIFtvcHRpb25zXSAtIE9wdGlvbmFsIG9wdGlvbnMgdG8gaW5pdGlhbGl6ZSB0aGUgYWQgbGlicmFyeSB3aXRoXG4gKiBAY29uc3RydWN0b3JcbiAqL1xudmFyIEFkTGliID0gZnVuY3Rpb24gKGVudmlyb25tZW50LCBvcHRpb25zKSB7XG4gICAgdGhpcy5hcHBsaWNhdGlvbklkID0gb3B0aW9ucyAmJiBvcHRpb25zLmFwcGxpY2F0aW9uSWQgfHwgdGhpcy5fZ2V0QXBwbGljYXRpb25JZCgpO1xuXG4gICAgdGhpcy5kZXZpY2VEZXRhaWxzID0gZGV2aWNlRGV0ZWN0b3IuZ2V0RGV2aWNlRGV0YWlscygpO1xuICAgIHRoaXMuZW52aXJvbm1lbnQgPSBlbnZpcm9ubWVudDtcbiAgICB0aGlzLl9hZFByb3ZpZGVyID0gbnVsbDtcbiAgICB0aGlzLnBhZ2UgPSBwYWdlO1xuICAgIHRoaXMuYWRNYW5hZ2VyID0gbnVsbDtcbiAgICB0aGlzLnBhdGggPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWU7XG5cblxuICAgIC8vIElmIHRoZSBzY3JpcHQgaW5jbHVkZSBpcyBwbGFjZWQgaW4gdGhlIDxoZWFkPiBvZiB0aGUgcGFnZSxcbiAgICAvLyBkb2N1bWVudC5ib2R5IGlzIG5vdCByZWFkeSB5ZXQsIGFuZCB3ZSBuZWVkIGl0IHRvIHJldHJpZXZlIHRoZSB0b2tlblxuICAgIGlmIChkb2N1bWVudC5ib2R5KSB7XG4gICAgICAgIHBhZ2UucHJlbG9hZFRva2VuKHRoaXMuZW52aXJvbm1lbnQpO1xuICAgIH1cbiAgICBwYWdlLmFkZERvbVJlYWR5TGlzdGVuZXIodGhpcy5lbnZpcm9ubWVudCk7XG5cbiAgICB0aGlzLl9zZXRVcFB1YmxpY0FQSSgpO1xufTtcblxuLyoqXG4gKiBUaGlzIGZ1bmN0aW9uIHNldHMgdXAgdGhlIHB1YmxpYyBBUEkgb24gdGhlIGJyb3dzZXJzJyB3aW5kb3cgb2JqZWN0XG4gKiBzbyB0aGF0IHB1Ymxpc2hlcnMgY2FuIGludGVyYWN0IHdpdGggc29tZSBmdW5jdGlvbnMgb2YgdGhlIEFkIExpYnJhcnkgc2hvdWxkIHRoZXkgbmVlZCB0b1xuICovXG5BZExpYi5wcm90b3R5cGUuX3NldFVwUHVibGljQVBJID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG5cbiAgICAvL25vaW5zcGVjdGlvbiBKU1VudXNlZEdsb2JhbFN5bWJvbHNcbiAgICB3aW5kb3dbYXBwU2V0dGluZ3MuZ2xvYmFsVmFyTmFtZV0gPSB7XG4gICAgICAgIHJlYWR5OiB0cnVlLFxuICAgICAgICAvKipcbiAgICAgICAgICogTG9hZCBvbmUgb3IgbW9yZSBhZFVuaXRzIG1hbnVhbGx5XG4gICAgICAgICAqIEBwYXJhbSB7c3RyaW5nW118c3RyaW5nfSBhZFVuaXROYW1lcyAtIFRoZSBuYW1lcyBvZiB0aGUgYWRVbml0cyB0byByZW1vdmVcbiAgICAgICAgICovXG4gICAgICAgIHRyaWdnZXI6IGZ1bmN0aW9uIChhZFVuaXROYW1lcykge1xuICAgICAgICAgICAgYWRVbml0TmFtZXMgPSB1dGlscy5zdHJpbmdUb0FycmF5KGFkVW5pdE5hbWVzKTtcbiAgICAgICAgICAgIGluc3RhbmNlLnRyaWdnZXIoYWRVbml0TmFtZXMpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgICogUmVmcmVzaCB0aGUgY3VycmVudCBhZHMgb24gdGhlIHBhZ2VcbiAgICAgICAgICovXG4gICAgICAgIHJlZnJlc2g6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGluc3RhbmNlLnJlZnJlc2goKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZSBvbmUgb3IgbW9yZSBhZCB1bml0cyBieSBzcGVjaWZ5aW5nIHRoZWlyIG5hbWVzXG4gICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfHN0cmluZ1tdfSBhZFVuaXROYW1lcyAtIHRoZSBuYW1lKHMpIG9mIHRoZSBhZFVuaXRzIHRvIHJlbW92ZVxuICAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlQWRVbml0czogZnVuY3Rpb24gKGFkVW5pdE5hbWVzKSB7XG4gICAgICAgICAgICBhZFVuaXROYW1lcyA9IHV0aWxzLnN0cmluZ1RvQXJyYXkoYWRVbml0TmFtZXMpO1xuICAgICAgICAgICAgaW5zdGFuY2UucmVtb3ZlQWRVbml0c0Zyb21QYWdlKGFkVW5pdE5hbWVzKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZSBhbGwgdGhlIGN1cnJlbnQgaW5zZXJ0ZWQgYWRzIGZyb20gdGhlIHBhZ2VcbiAgICAgICAgICovXG4gICAgICAgIHJlbW92ZUFsbEFkczogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaW5zdGFuY2UuYWRNYW5hZ2VyLnJlbW92ZUFsbEFkcygpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgICogQ29tcGxldGVseSByZWxvYWQgdGhlIGFkIGxpYnJhcnkgYW5kIHJlLXJlYWQgdGhlIGFkIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgICovXG4gICAgICAgIHJlbG9hZDogaW5zdGFuY2UucmVsb2FkLmJpbmQoaW5zdGFuY2UpLFxuICAgICAgICBldmVudHM6IGV2ZW50c1xuICAgIH07XG5cbiAgICB2YXIgbWVzc2FnZURhdGEgPSB7XG4gICAgICAgIHNlbmRlcjogYXBwU2V0dGluZ3MuZ2xvYmFsVmFyTmFtZSxcbiAgICAgICAgbWVzc2FnZTogXCJyZWFkeVwiXG4gICAgfTtcblxuICAgIC8vbm9pbnNwZWN0aW9uIEpTVW5yZXNvbHZlZEZ1bmN0aW9uXG4gICAgd2luZG93LnBvc3RNZXNzYWdlKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2VEYXRhKSwgJyonKTtcbiAgICBsb2dnZXIuaW5mbyhcIlB1YmxpYyBBUEkgaW5pdGlhbGl6ZWQgb24gdmFyICdcIiArIGFwcFNldHRpbmdzLmdsb2JhbFZhck5hbWUgKyBcIidcIik7XG59O1xuXG4vKipcbiAqIEluaXRpYXRlcyB0aGUgYWQgbGlicmFyeSBieSByZWFkaW5nIHRoZSBjb25maWd1cmF0aW9uIGZpbGUgYW5kIHN0YXJ0aW5nXG4gKiB0aGUgcHJvY2VzcyBvZiBwbGFjaW5nIGFkcyBvbiB0aGUgcGFnZVxuICovXG5BZExpYi5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRoaXMuYXBwbGljYXRpb25JZCkge1xuICAgICAgICBsb2dnZXIud3RmKCdDb3VsZCBub3QgcmV0cmlldmUgYXBwbGljYXRpb25JZCcpO1xuICAgICAgICByZXR1cm47IC8vRXhpdCB0aGUgYXBwbGljYXRpb25cbiAgICB9XG5cbiAgICB0aGlzLl9pbml0QWRNYW5hZ2VyKHRoaXMuYXBwbGljYXRpb25JZCk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBhbGwgdGhlIGFkcyBmcm9tIHRoZSBjdXJyZW50IHBhZ2UgYW5kIHJlbG9hZCB0aGUgY29uZmlndXJhdGlvblxuICovXG5BZExpYi5wcm90b3R5cGUucmVsb2FkID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuYWRNYW5hZ2VyLnJlbW92ZUFsbEFkcygpO1xuICAgIHRoaXMuaW5pdCgpO1xufTtcblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBhZCBtYW5hZ2VyIGFuZCBsZXRzIHRoZSBtYW5hZ2VyIHN0YXJ0cyBpdHMgaW5zZXJ0aW9uXG4gKiBAcHJpdmF0ZVxuICovXG5BZExpYi5wcm90b3R5cGUuX2luaXRBZE1hbmFnZXIgPSBmdW5jdGlvbiAoYXBwbGljYXRpb25JZCkge1xuICAgIHRoaXMuYWRNYW5hZ2VyID0gbmV3IEFkTWFuYWdlcihhcHBsaWNhdGlvbklkLCB0aGlzLmRldmljZURldGFpbHMsIHRoaXMuZW52aXJvbm1lbnQpO1xuICAgIHRoaXMuYWRNYW5hZ2VyLmxvYWRBZHMoKTtcblxuICAgIHRoaXMuX3N0YXJ0UGF0aENoYW5nZVBvbGxpbmcoKTtcbn07XG5cbi8qKlxuICogU3RhcnRzIHBvbGxpbmcgd2luZG93LmxvY2F0aW9uLnBhdGggZm9yIGNoYW5nZXMgYW5kXG4gKiByZWZyZXNoZXMgdGhlIGFkcyBpZiBhIGNoYW5nZSBpcyBkZXRlY3RlZFxuICogQHByaXZhdGVcbiAqL1xuQWRMaWIucHJvdG90eXBlLl9zdGFydFBhdGhDaGFuZ2VQb2xsaW5nID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZXRJbnRlcnZhbChmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh3aW5kb3cubG9jYXRpb24ucGF0aG5hbWUgIT09IHNlbGYucGF0aCkge1xuICAgICAgICAgICAgLy9SZWZyZXNoIHRoZSBBZExpYiBpZiB0aGUgUGF0aG5hbWUgaGFzIGNoYW5nZWRcbiAgICAgICAgICAgIC8vVGhpcyBjYW4gYmUgdmVyeSBjb21tb24gb24gc2luZ2xlIHBhZ2UgYXBwbGljYXRpb25zIHVzaW5nXG4gICAgICAgICAgICAvL1RoZSBicm93c2VyIGhpc3RvcnkgQVBJXG4gICAgICAgICAgICBzZWxmLnBhdGggPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWU7XG4gICAgICAgICAgICBzZWxmLnJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgIH0sIDUwMCk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSB0aGUgYWRVbml0cyBzcGVjaWZpZWQgZnJvbSB0aGUgY3VycmVudCBwYWdlXG4gKiBAcGFyYW0ge0FycmF5LjxzdHJpbmc+fSBhZFVuaXROYW1lcyAtIFRoZSBuYW1lcyBvZiB0aGUgYWRVbml0cyB0byByZW1vdmVcbiAqL1xuQWRMaWIucHJvdG90eXBlLnJlbW92ZUFkVW5pdHNGcm9tUGFnZSA9IGZ1bmN0aW9uIChhZFVuaXROYW1lcykge1xuICAgIHRoaXMuYWRNYW5hZ2VyLnJlbW92ZUFkVW5pdHMoYWRVbml0TmFtZXMpO1xufTtcblxuXG4vKipcbiAqIFRoaXMgbWV0aG9kIGNhbiBiZSB1c2VkIGZvciBtYW51YWxseSB0cmlnZ2VyaW5nIGEgcmVsb2FkIG9mIHRoZSBhZHMgb24gdGhlIHBhZ2VcbiAqXG4gKiBGb3IgZXhhbXBsZSwgYSBzaW5nbGUtcGFnZSBhcHBsaWNhdGlvbiBkb2VzIG5vdCByZWxvYWQgdGhlIHNjcmlwdCB3aGVuXG4gKiBjaGFuZ2luZyB0aGUgcGFnZXMuIFRoZSBBZExpYiBBUEkgZXhwb3NlZCBvbiB0aGUgYnJvd3NlcidzIHdpbmRvdyB2YXJpYWJsZVxuICogQ2FuIHVzZSB0aGUgcmVmcmVzaCBmdW5jdGlvbiB0byBtYW51YWxseSB0cmlnZ2VyIGEgcmVsb2FkIG9mIHRoZSBhZHMgb24gYSBwYWdlXG4gKi9cbkFkTGliLnByb3RvdHlwZS5yZWZyZXNoID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuYWRNYW5hZ2VyLnJlZnJlc2goKTtcbn07XG5cbi8qKlxuICogTWFudWFsbHkgdHJpZ2dlciBjZXJ0YWluIGFkIHVuaXRzIHRvIGJlIGluc2VydGVkIG9uIGEgcGFnZVxuICpcbiAqIFRoaXMgaXMgZm9yIGFkVW5pdHMgd2l0aCB0aGUgdHJpZ2dlciBwcm9wZXJ0eSBzcGVjaWZpZWRcbiAqIEZvciBleGFtcGxlLCB3aGVuIGEgZGlhbG9nIGxvYWRzLCBhZHMgaW4gdGhpcyBkaWFsb2cgY2FuIGJlIHNob3duIGJ5IHVzaW5nXG4gKiB0aGUgdHJpZ2dlciBtZXRob2QgZXhwb3NlZCBieSB0aGUgQWRMaWIgQVBJIG9uIHRoZSBicm93c2VyJ3Mgd2luZG93IG9iamVjdFxuICpcbiAqIEBwYXJhbSB7QXJyYXkuPFN0cmluZz59IHVuaXRUcmlnZ2VycyAtIEFycmF5IG9mIHRoZSBhZFVuaXQgbmFtZXMgdG8gdHJpZ2dlclxuICovXG5BZExpYi5wcm90b3R5cGUudHJpZ2dlciA9IGZ1bmN0aW9uICh1bml0VHJpZ2dlcnMpIHtcbiAgICB0aGlzLmFkTWFuYWdlci50cmlnZ2VyKHVuaXRUcmlnZ2Vycyk7XG59O1xuXG5cbm1vZHVsZS5leHBvcnRzID0gQWRMaWI7XG4iLCIvKipcbiAqIENyZWF0ZWQgYnkgTmlla0tydXNlIG9uIDEwLzE1LzE1LlxuICpcbiAqIFRoZSBhZHMgYnVpbGRlciBtb2R1bGUgdGFrZXMgY2FyZSBvZiBidWlsZGluZyB0aGUgSFRNTCBzdHJ1Y3R1cmUgb2YgdGVoIGFkXG4gKi9cbnZhciBsb2dnZXIgPSByZXF1aXJlKCcuLi91dGlsL2xvZ2dlcicpLFxuICAgIGFwcFNldHRpbmdzID0gcmVxdWlyZSgnLi4vYXBwU2V0dGluZ3MnKTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBBZE1hY3JvIC0gVGhlIG1hY3JvIG9iamVjdCBkZWZpbmluZyBhZCBtYWNyb3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBBZE1hY3JvLm1hY3JvIC0gVGhlIG1hY3JvIHRvIHNlYXJjaCBmb3IgaW4gdGhlIHN0cmluZ1xuICogQHByb3BlcnR5IHtzdHJpbmd9IEFkTWFjcm8ucHJvcCAtIFRoZSBwcm9wZXJ0eSBpbiB0aGUgb2JqZWN0IHRvIHJlcGxhY2UgdGhlIHZhbHVlIHdpdGhcbiAqIFRoZSBtYWNyb3MgdG8gcmVwbGFjZSBmb3IgdGhlIGFjdHVhbCBhZHZlcnRpc2VtZW50XG4gKiBAdHlwZSB7QXJyYXkuPEFkTWFjcm8+fVxuICovXG52YXIgYWRNYWNyb3MgPSBbXG4gICAge1xuICAgICAgICBtYWNybzogXCIjI2NhbXBhaWduX25hbWUjI1wiLFxuICAgICAgICBwcm9wOiBcImNhbXBhaWduX25hbWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBtYWNybzogXCIjI2NhbXBhaWduX2Rlc2NyaXB0aW9uIyNcIixcbiAgICAgICAgcHJvcDogXCJjYW1wYWlnbl9kZXNjcmlwdGlvblwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG1hY3JvOiBcIiMjY2xpY2tfdXJsIyNcIixcbiAgICAgICAgcHJvcDogXCJjbGlja191cmxcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBtYWNybzogXCIjI2NhdGVnb3J5X25hbWUjI1wiLFxuICAgICAgICBwcm9wOiBcImNhdGVnb3J5X25hbWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBtYWNybzogXCIjI2NhbXBhaWduX2ltYWdlX3VybCMjXCIsXG4gICAgICAgIHByb3A6IFwiY2FtcGFpZ25faW1hZ2VcIlxuICAgIH1cbl07XG5cbnZhciBjaGlsZFRhZ0RpY3Rpb25hcnkgPSB7XG4gICAgdGFibGU6IFwidGJvZHlcIixcbiAgICB0Ym9keTogXCJ0clwiLFxuICAgIHRoZWFkZXI6IFwidHJcIixcbiAgICB0cjogXCJ0ZFwiXG59O1xuXG4vKipcbiAqIFJlcGxhY2VzIG1hY3JvcyBpbiBhIHN0cmluZyB3aXRoIHRoZSBwcm9wZXJ0aWVzIG9mIGFuIG9iamVjdFxuICogQHBhcmFtIHMgVGhlIHN0cmluZyB0byByZXBsYWNlIHRoZSBtYWNyb3MgaW5cbiAqIEBwYXJhbSBtYWNyb3MgVGhlIG1hY3JvcyB0byByZXBsYWNlIHRoZSBzdHJpbmcgd2l0aFxuICogQHBhcmFtIG9iaiB0aGUgb2JqZWN0IHRvIGdldCB0aGUgbWFjcm8gcHJvcGVydGllcyBmcm9tXG4gKiBAcmV0dXJucyB7U3RyaW5nfSAtIFRoZSBzdHJpbmcgd2l0aCB0aGUgbWFjcm9zIHJlcGxhY2VkXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBfcmVwbGFjZU1hY3JvcyhzLCBtYWNyb3MsIG9iaikge1xuICAgIHZhciByZWdleCA9IG51bGw7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYWNyb3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG1hY3JvID0gbWFjcm9zW2ldO1xuICAgICAgICByZWdleCA9IG5ldyBSZWdFeHAobWFjcm8ubWFjcm8sIFwiZ1wiKTtcblxuICAgICAgICBzID0gcy5yZXBsYWNlKHJlZ2V4LCBvYmpbbWFjcm8ucHJvcF0pO1xuICAgIH1cblxuICAgIHJldHVybiBzO1xufVxuXG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vL1N0YXJ0IG9mIEFQSVxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBhZEJ1aWxkZXJcbiAqIEBwYXJhbSBhZHMgYXJyYXkgb2YgYWRzIHByb3ZpZGVkIGJ5IHRoZSBhZHNGZXRjaGVyXG4gKiBAY29uc3RydWN0b3JcbiAqL1xudmFyIEFkQnVpbGRlciA9IGZ1bmN0aW9uIChhZHMpIHtcbiAgICB0aGlzLl9hZHMgPSBhZHM7XG4gICAgdGhpcy5fdWlkID0gMDtcbn07XG5cbi8qKlxuICogUmVwbGFjZXMgdGhlIG1hY3JvcyBmb3IgdGhlIGFjdHVhbCBhZHZlcnRpc2VtZW50XG4gKiBAcGFyYW0ge3N0cmluZ30gaHRtbFN0cmluZyAtIFRoZSBodG1sIHRlbXBsYXRlIHN0cmluZ1xuICogQHBhcmFtIGFkIHRoZSBhZCB0byB1c2UgZm9yIHRoZSBhZFVuaXRcbiAqIEByZXR1cm5zIHtTdHJpbmd9IHRoZSBodG1sU3RyaW5nIHdpdGggcmVwbGFjZWQgbWFjcm9zXG4gKiBAcHJpdmF0ZVxuICovXG5BZEJ1aWxkZXIucHJvdG90eXBlLl9yZXBsYWNlQWRNYWNyb3MgPSBmdW5jdGlvbiAoaHRtbFN0cmluZywgYWQpIHtcbiAgICByZXR1cm4gX3JlcGxhY2VNYWNyb3MoaHRtbFN0cmluZywgYWRNYWNyb3MsIGFkKTtcbn07XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhY3R1YWwgYWRVbml0IGZyb20gYWRVbml0U2V0dGluZ3NcbiAqIEBwYXJhbSBhZFVuaXRTZXR0aW5ncyB0aGUgc2V0dGluZ3MgZm9yIHRoZSBhZFVuaXRcbiAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGFkQ29udGFpbmVyRWxlbWVudCAtIFRoZSBIVE1MIGVsZW1lbnQgb2YgdGhlIGFkIGNvbnRhaW5lclxuICogQHJldHVybnMge05vZGV9IHRoZSBIVE1MIE5vZGUgZm9yIHRoZSBhZCB1bml0XG4gKi9cbkFkQnVpbGRlci5wcm90b3R5cGUuY3JlYXRlQWRVbml0ID0gZnVuY3Rpb24gKGFkVW5pdFNldHRpbmdzLCBhZENvbnRhaW5lckVsZW1lbnQpIHtcbiAgICB2YXIgaHRtbFN0cmluZyA9IGFkVW5pdFNldHRpbmdzLmh0bWxUZW1wbGF0ZTtcbiAgICB2YXIgYWQgPSB0aGlzLl9hZHMuc2hpZnQoKTtcblxuICAgIGlmICghYWQpIHtcbiAgICAgICAgLy9XZSByYW4gb3V0IG9mIGFkc1xuICAgICAgICAvL1RPRE86IHdoYXQgZG8gaW4gdGhpcyBjYXNlP1xuICAgICAgICBsb2dnZXIuZXJyb3IoXCJSYW4gb3V0IG9mIGFkcyBiZWZvcmUgYWxsIGFkcyBjb3VsZCBiZSBpbnNlcnRlZFwiKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgLy9DcmVhdGUgYSB0ZW1wb3JhcnkgZGl2IHRvIHdyYXAgdGhlIGlubmVyaHRtbCBpbVxuICAgIHZhciB0ZW1wRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChhZENvbnRhaW5lckVsZW1lbnQudGFnTmFtZSk7XG4gICAgdGVtcERpdi5pbm5lckhUTUwgPSBodG1sU3RyaW5nO1xuXG4gICAgLy9HZXQgdGhlIGh0bWxUZW1wbGF0ZSBzdHJpbmcgYXMgYSBET00gb2JqZWN0XG4gICAgdmFyIGFkRWxlbWVudCA9IHRlbXBEaXYuZmlyc3RDaGlsZDtcbiAgICBhZEVsZW1lbnQuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgYWRFbGVtZW50LmNsYXNzTmFtZSA9IGFwcFNldHRpbmdzLmFkRWxlbWVudENsYXNzbmFtZTtcbiAgICBhZEVsZW1lbnQuaWQgPSB0aGlzLl9uZXdBZEVsZW1lbnRJRCgpO1xuXG4gICAgaHRtbFN0cmluZyA9IHRlbXBEaXYuaW5uZXJIVE1MO1xuICAgIGh0bWxTdHJpbmcgPSB0aGlzLl9yZXBsYWNlQWRNYWNyb3MoaHRtbFN0cmluZywgYWQpO1xuXG4gICAgdGVtcERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoYWRDb250YWluZXJFbGVtZW50LnRhZ05hbWUpO1xuICAgIHRlbXBEaXYuaW5uZXJIVE1MID0gaHRtbFN0cmluZztcblxuICAgIGFkRWxlbWVudCA9IHRlbXBEaXYuZmlyc3RDaGlsZDtcblxuICAgIHJldHVybiBhZEVsZW1lbnQ7XG59O1xuXG4vKipcbiAqIEdlbmVyYXRlcyBhIG5ldyBVbmlxdWUgSUQgZm9yIGFuIGFkIHVuaXRcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSBuZXcgdW5pcXVlSURcbiAqIEBwcml2YXRlXG4gKi9cbkFkQnVpbGRlci5wcm90b3R5cGUuX25ld0FkRWxlbWVudElEID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBcInBvY2tldF9hZFVuaXRfXCIgKyB0aGlzLl91aWQrKztcbn07XG5cbi8qKlxuICogQ3JlYXRlIGEgbmV3IGNoaWxkIGVsZW1lbnQgZm9yIGEgdGFnIHdpdGggYSBjZXJ0YWluIHRhZyBuYW1lXG4gKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gVGhlIGVsZW1lbnQgdG8gY3JlYXRlIGEgY2hpbGQgZWxlbWVudCBmb3JcbiAqIEByZXR1cm5zIHtIVE1MRWxlbWVudH0gdGhlIGNoaWxkIGVsZW1lbnRcbiAqIEBwcml2YXRlXG4gKi9cbkFkQnVpbGRlci5wcm90b3R5cGUuX2NyZWF0ZUVtcHR5Q2hpbGRFbGVtZW50ID0gZnVuY3Rpb24gKGVsZW1lbnQpIHtcbiAgICB2YXIgZWxlbWVudFRhZ05hbWUgPSBlbGVtZW50LnRhZ05hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgIHZhciB0YWdOYW1lVG9DcmVhdGUgPSBjaGlsZFRhZ0RpY3Rpb25hcnlbZWxlbWVudFRhZ05hbWVdIHx8ICdkaXYnOyAvL1NpbXBseSBjcmVhdGUgYSBkaXYgaXQgaWYgaXQgaXMgbm90IGtub3duIGluIHRoZSBkaWN0aW9uYXJ5XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnTmFtZVRvQ3JlYXRlKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQWRCdWlsZGVyO1xuIiwiLyoqXG4gKiBDcmVhdGVkIGJ5IE5pZWtLcnVzZSBvbiAxMC8xOS8xNS5cbiAqXG4gKiBNb2R1bGUgdGhhdCBmdW5jdGlvbnMgYXMgYSB3cmFwcGVyIGFyb3VuZCB0aGUgYWQgY29udGFpbmVyIGVsZW1lbnRcbiAqIENvbnRhaW5pbmcgdXNlZnVsIGZ1bmN0aW9ucyBmb3IgZmluZGluZyB0aGUgbmV4dCBwb3NpdGlvbiBpbiBhbiBhZENvbnRhaW5lclxuICovXG52YXIgQWRDb250YWluZXIgPSBmdW5jdGlvbiAoYWRDb250YWluZXJTZXR0aW5ncywgY29udGFpbmVyRWxlbWVudCkge1xuICAgIHRoaXMuY29udGFpbmVyRWxlbWVudCA9IGNvbnRhaW5lckVsZW1lbnQ7XG4gICAgdGhpcy5fY3VycmVudEluZGV4ID0gYWRDb250YWluZXJTZXR0aW5ncy5zdGFydEluZGV4O1xuXG4gICAgdGhpcy5jaGlsZEVsZW1lbnRzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5jb250YWluZXJFbGVtZW50LmNoaWxkcmVuKTtcbiAgICB2YXIgaW50ZXJ2YWwgPSBhZENvbnRhaW5lclNldHRpbmdzLmludGVydmFsO1xuICAgIGlmICghaW50ZXJ2YWwpIHtcbiAgICAgICAgaW50ZXJ2YWwgPSB0aGlzLl9jYWxjdWxhdGVJbnRlcnZhbChhZENvbnRhaW5lclNldHRpbmdzLm1heE51bWJlck9mQWRzKTtcbiAgICB9XG5cbiAgICB0aGlzLl9zdGFydEluZGV4ID0gYWRDb250YWluZXJTZXR0aW5ncy5zdGFydEluZGV4O1xuICAgIHRoaXMuX2ludGVydmFsID0gaW50ZXJ2YWw7XG59O1xuXG4vKipcbiAqIENhbGN1bGF0ZSB0aGUgaW50ZXJ2YWwgZm9yIGEgdW5pdCB3aGVyZSBvbmx5IGEgbWF4IG51bWJlciBpcyBzZXRcbiAqIEBwYXJhbSBtYXhOdW1iZXJPZkFkcyB0aGUgbWF4IG51bWJlciBvZiBhZHMgdG8gYWQgdG8gdGhlIHBhcmVudCBjb250YWluZXJcbiAqIEBwcml2YXRlXG4gKi9cbkFkQ29udGFpbmVyLnByb3RvdHlwZS5fY2FsY3VsYXRlSW50ZXJ2YWwgPSBmdW5jdGlvbiAobWF4TnVtYmVyT2ZBZHMpIHtcbiAgICB2YXIgZWxlbWVudHMgPSB0aGlzLmNoaWxkRWxlbWVudHMuc2xpY2UodGhpcy5fc3RhcnRJbmRleCAtIDEpO1xuICAgIC8vVE9ETzogbWF5YmUgaW1wcm92ZT9cbiAgICByZXR1cm4gTWF0aC5yb3VuZChlbGVtZW50cy5sZW5ndGggLyBtYXhOdW1iZXJPZkFkcyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgbmV4dCBlbGVtZW50IGFmdGVyIHdoaWNoIGFuIGFkIHNob3VsZCBiZSBpbnNlcnRlZFxuICogQHJldHVybnMge05vZGV8bnVsbH0gLSB0aGUgSFRNTCBub2RlIHRvIGluc2VydCBhZnRlciwgb3IgbnVsbCBpZiBpdCBkb2VzIG5vdCBleGlzdFxuICovXG5BZENvbnRhaW5lci5wcm90b3R5cGUuZ2V0TmV4dEVsZW1lbnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMuX2N1cnJlbnRJbmRleCA+IHRoaXMuY2hpbGRFbGVtZW50cy5sZW5ndGggLSAxKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBlbGVtZW50ID0gdGhpcy5jaGlsZEVsZW1lbnRzW3RoaXMuX2N1cnJlbnRJbmRleF07XG4gICAgdGhpcy5fY3VycmVudEluZGV4ICs9IHRoaXMuX2ludGVydmFsO1xuICAgIFxuICAgIHJldHVybiBlbGVtZW50O1xufTtcblxuLyoqXG4gKiBnZXQgdGhlIG51bWJlciBvZiBhZHMgdG8gaW5zZXJ0IGluIHRoaXMgYWRDb250YWluZXJcbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gdGhlIG51bWJlciBvZiBhZHMgdG8gaW5zZXJ0XG4gKi9cbkFkQ29udGFpbmVyLnByb3RvdHlwZS5nZXROdW1iZXJPZkFkc1RvSW5zZXJ0ID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBpbmRleCA9IHRoaXMuX3N0YXJ0SW5kZXg7XG4gICAgdmFyIGNvdW50ZXIgPSAwO1xuXG4gICAgd2hpbGUgKHRoaXMuY2hpbGRFbGVtZW50c1tpbmRleF0pIHtcbiAgICAgICAgY291bnRlcisrO1xuICAgICAgICBpbmRleCArPSB0aGlzLl9pbnRlcnZhbDtcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRlcjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQWRDb250YWluZXI7XG4iLCIvKipcbiAqIENyZWF0ZWQgYnkgTmlla0tydXNlIG9uIDEwLzE2LzE1LlxuICpcbiAqIFRoZSBBZE1hbmFnZXIgbW9kdWxlIHRha2VzIGNhcmUgb2YgYW55dGhpbmcgYWRzIHJlbGF0ZWQgb24gdGhlIHBhZ2UgYW5kIGRpc3RyaWJ1dGVzIHRhc2tzIHRvIHRoZSByaWdodCBtb2R1bGVzXG4gKi9cbnZhciBpbnNlcnRBZHMgPSByZXF1aXJlKCcuL2luc2VydEFkcycpLFxuICAgIGZldGNoQ29uZmlndXJhdGlvbiA9IHJlcXVpcmUoJy4uL2FkQ29uZmlndXJhdGlvbi9mZXRjaENvbmZpZ3VyYXRpb24nKSxcbiAgICBmZXRjaEFkcyA9IHJlcXVpcmUoJy4vZmV0Y2hBZHMnKSxcbiAgICBwYWdlID0gcmVxdWlyZSgnLi4vcGFnZScpLFxuICAgIGxvZ2dlciA9IHJlcXVpcmUoJy4uL3V0aWwvbG9nZ2VyJyksXG4gICAgZXZlbnRzID0gcmVxdWlyZSgnLi4vZXZlbnRzJyk7XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgYWRNYW5hZ2VyXG4gKiBAcGFyYW0gYXBwbGljYXRpb25JZCAtIFRoZSBJRCBvZiB0aGUgYXBwbGljYXRpb24gdG8gcmVjZWl2ZSBhZHMgZm9yXG4gKiBAcGFyYW0gZGV2aWNlRGV0YWlscyAtIERldGFpbHMgYWJvdXQgdGhlIGN1cnJlbnQgdXNlcnMnIGRldmljZVxuICogQHBhcmFtIGVudmlyb25tZW50IC0gRW52aXJvbm1lbnQgc3BlY2lmaWMgZnVuY3Rpb25zLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbnZhciBBZE1hbmFnZXIgPSBmdW5jdGlvbiAoYXBwbGljYXRpb25JZCwgZGV2aWNlRGV0YWlscywgZW52aXJvbm1lbnQpIHtcbiAgICB0aGlzLmFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkO1xuICAgIHRoaXMuZGV2aWNlRGV0YWlscyA9IGRldmljZURldGFpbHM7XG4gICAgdGhpcy5lbnZpcm9ubWVudCA9IGVudmlyb25tZW50O1xuICAgIHRoaXMuX2N1cnJlbnRBZHMgPSBbXTtcbiAgICB0aGlzLl9sb2FkaW5nQWRzID0gW107XG4gICAgdGhpcy5fYWRzV2l0aG91dEltYWdlcyA9IFtdO1xufTtcblxuLyoqXG4gKiBTdGFydHMgdGhlIGFkTWFuYWdlciB0byBkZXRlY3Qgd2hpY2ggYWRzIHNob3VsZCBiZSBpbnNlcnRlZFxuICogaW4gdGhlIGN1cnJlbnQgY29udGV4dCBvZiB0aGUgcGFnZSBhbmQgc3RhcnRzIHRoZSBpbnNlcnRpb25cbiAqIG9mIHRoZXNlIGFkc1xuICovXG5BZE1hbmFnZXIucHJvdG90eXBlLmxvYWRBZHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuX2dldEFkVW5pdHNGb3JDdXJyZW50UGFnZShmdW5jdGlvbiAoYWRVbml0cykge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFkVW5pdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBhZFVuaXQgPSBhZFVuaXRzW2ldO1xuICAgICAgICAgICAgc2VsZi5nZXRBZHNGb3JBZFVuaXQoYWRVbml0KTtcbiAgICAgICAgfVxuICAgIH0pO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSBhZHMgZm9yIHRoZSBnaXZlbiBhZCB1bml0XG4gKiBAcGFyYW0gYWRVbml0IC0gVGhlIGFkIHVuaXQgdG8gcmV0cmlldmUgYWRzIGZvclxuICovXG5BZE1hbmFnZXIucHJvdG90eXBlLmdldEFkc0ZvckFkVW5pdCA9IGZ1bmN0aW9uIChhZFVuaXQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBwYWdlLndoZW5SZWFkeShmdW5jdGlvbiAoKSB7XG4gICAgICAgIGZldGNoQWRzKGFkVW5pdCwgZnVuY3Rpb24gKGFkcykge1xuICAgICAgICAgICAgaWYgKGFkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoJ05vIGFkcyByZXRyaWV2ZWQgZnJvbSBPZmZlckVuZ2luZScpO1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy9EbyBub3QgY29udGludWUuXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNlbGYuX29uQWRzTG9hZGVkKGFkVW5pdCwgYWRzKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59O1xuXG5cbi8qKlxuICogUmVtb3ZlIGFsbCB0aGUgY3VycmVudGx5IGluc2VydGVkIGFkc1xuICovXG5BZE1hbmFnZXIucHJvdG90eXBlLnJlbW92ZUFsbEFkcyA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLl9yZW1vdmVJbnNlcnRlZEFkcyh0aGlzLl9jdXJyZW50QWRzKTtcbiAgICB0aGlzLl9jdXJyZW50QWRzID0gW107XG59O1xuXG5cbi8qKlxuICogTWFudWFsbHkgdHJpZ2dlciBzb21lIGFkVW5pdHMgdG8gbG9hZFxuICogQHBhcmFtIHtzdHJpbmdbXX0gdHJpZ2dlcnMgLSBUaGUgdHJpZ2dlcihzKSBvZiB0aGUgYWRVbml0c1xuICovXG5BZE1hbmFnZXIucHJvdG90eXBlLnRyaWdnZXIgPSBmdW5jdGlvbiAodHJpZ2dlcnMpIHtcbiAgICB2YXIgYWRVbml0cyA9IHRoaXMuYWRDb25maWcuZ2V0QWRVbml0c1dpdGhUcmlnZ2VyKHRyaWdnZXJzKTtcblxuICAgIGlmIChhZFVuaXRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5fbG9hZEFkVW5pdHMoYWRVbml0cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oXCJObyBBZFVuaXRzIGZvdW5kIHdpdGggdHJpZ2dlcihzKTogXCIgKyB0cmlnZ2Vycy5qb2luKFwiLFwiKSk7XG4gICAgfVxufTtcblxuLyoqXG4gKiBSZW1vdmVzIGFkVW5pdHMgd2l0aCBnaXZlbiBuYW1lcyBmcm9tIHRoZSBwYWdlXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBhZFVuaXRzVG9SZW1vdmUgLSBBcnJheSBjb250YWluaW5nIHRoZSBuYW1lcyBvZiB0aGUgYWQgdW5pdHMgdG8gcmVtb3ZlXG4gKi9cbkFkTWFuYWdlci5wcm90b3R5cGUucmVtb3ZlQWRVbml0cyA9IGZ1bmN0aW9uIChhZFVuaXRzVG9SZW1vdmUpIHtcbiAgICB2YXIgY3VycmVudEFkc1RvUmVtb3ZlID0gdGhpcy5fY3VycmVudEFkcy5maWx0ZXIoZnVuY3Rpb24gKGRldGFpbHMpIHtcbiAgICAgICAgcmV0dXJuIGFkVW5pdHNUb1JlbW92ZS5pbmRleE9mKGRldGFpbHMuYWRVbml0Lm5hbWUpID4gLTE7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9yZW1vdmVJbnNlcnRlZEFkcyhjdXJyZW50QWRzVG9SZW1vdmUpO1xufTtcblxuLyoqXG4gKiBSZWZyZXNoZXMgdGhlIGFkIGxpYnJhcnkgb24gdGhlIHBhZ2VcbiAqL1xuQWRNYW5hZ2VyLnByb3RvdHlwZS5yZWZyZXNoID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMucmVtb3ZlQWxsQWRzKCk7XG4gICAgdGhpcy5sb2FkQWRzKCk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgYWQgY29uZmlndXJhdGlvbiBmb3IgdGhlIGN1cnJlbnQgcGFnZVxuICogQHByaXZhdGVcbiAqL1xuQWRNYW5hZ2VyLnByb3RvdHlwZS5fZ2V0QWRVbml0c0ZvckN1cnJlbnRQYWdlID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgZmV0Y2hDb25maWd1cmF0aW9uKHRoaXMuZW52aXJvbm1lbnQsIHRoaXMuYXBwbGljYXRpb25JZCwgZnVuY3Rpb24gKGVyciwgYWRVbml0cykge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoJ0NvdWxkIG5vdCBmZXRjaCBhZCBjb25maWd1cmF0aW9uLicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbG9nZ2VyLmluZm8oJ1JlY2VpdmVkICcgKyBhZFVuaXRzLmxlbmd0aCArICcgYWQgdW5pdHMgdG8gcnVuIG9uIHRoZSBjdXJyZW50IHBhZ2UnKTtcbiAgICAgICAgY2FsbGJhY2soYWRVbml0cyk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSB0aGUgZ2l2ZW4gaW5zZXJ0ZWQgYWRzIG9uIHRoZSBwYWdlXG4gKiBAcGFyYW0gY3VycmVudEFkcyAtIFRoZSBjdXJyZW50IGluc2VydGVkIGFkcyB0byByZW1vdmVcbiAqIEBwcml2YXRlXG4gKi9cbkFkTWFuYWdlci5wcm90b3R5cGUuX3JlbW92ZUluc2VydGVkQWRzID0gZnVuY3Rpb24gKGN1cnJlbnRBZHMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGN1cnJlbnRBZHMubGVuZ3RoOyBpKyspIHtcblxuICAgICAgICB2YXIgY3VycmVudEFkID0gY3VycmVudEFkc1tpXTtcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBjdXJyZW50QWQuYWRFbGVtZW50cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgdmFyIGFkRWxlbWVudFRvUmVtb3ZlID0gY3VycmVudEFkLmFkRWxlbWVudHNbal07XG4gICAgICAgICAgICBhZEVsZW1lbnRUb1JlbW92ZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGFkRWxlbWVudFRvUmVtb3ZlKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbi8qKlxuICogQ2FsbGJhY2sgdGhhdCBnZXRzIGNhbGxlZCB3aGVuIHRoZSBhZHMgYXJlIGxvYWRlZCBmcm9tIHRoZSBBZFByb3ZpZGVyXG4gKiBAcGFyYW0ge09iamVjdH0gYWRVbml0IC0gdGhlIGFkVW5pdCB0byB3aGljaCB0aGUgYWRzIGJlbG9uZ1xuICogQHBhcmFtIHtbXX0gYWRzIC0gQXJyYXkgb2YgYWRzIG9idGFpbmVkIGZyb20gdGhlIHNlcnZlclxuICogQHByaXZhdGVcbiAqL1xuQWRNYW5hZ2VyLnByb3RvdHlwZS5fb25BZHNMb2FkZWQgPSBmdW5jdGlvbiAoYWRVbml0LCBhZHMpIHtcbiAgICB2YXIgaW5zZXJ0ZWRBZHMgPSBpbnNlcnRBZHMoYWRVbml0LCBhZHMsIHRoaXMuX2FkSW1hZ2VEb25lTG9hZGluZy5iaW5kKHRoaXMpKTtcbiAgICBpZiAoaW5zZXJ0ZWRBZHMpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudEFkcy5wdXNoKHtcbiAgICAgICAgICAgIGFkVW5pdDogYWRVbml0LFxuICAgICAgICAgICAgYWRFbGVtZW50czogaW5zZXJ0ZWRBZHNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5fbG9hZGluZ0FkcyA9IHRoaXMuX2xvYWRpbmdBZHMuY29uY2F0KGluc2VydGVkQWRzKTtcbiAgICB9XG5cbiAgICB0aGlzLl9jaGVja0FsbEFkSW1hZ2VzRG9uZSgpO1xufTtcblxuLyoqXG4gKiBDYWxsYmFjayB0aGF0IGlzIGV4ZWN1dGVkIGVhY2ggdGltZSB0aGUgaW1hZ2Ugb2YgYW4gYWQgaXMgZG9uZSBsb2FkaW5nXG4gKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBhZEVsZW1lbnQgLSBUaGUgZWxlbWVudCB0aGF0IGlzIGRvbmUgbG9hZGluZ1xuICogQHBhcmFtIHtib29sZWFufSBoYXNJbWFnZSAtIEJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhZCBjb250YWluZWQgYW4gaW1hZ2VcbiAqIEBwcml2YXRlXG4gKi9cbkFkTWFuYWdlci5wcm90b3R5cGUuX2FkSW1hZ2VEb25lTG9hZGluZyA9IGZ1bmN0aW9uIChhZEVsZW1lbnQsIGhhc0ltYWdlKSB7XG4gICAgaWYgKCFoYXNJbWFnZSkge1xuICAgICAgICB0aGlzLl9hZHNXaXRob3V0SW1hZ2VzLnB1c2goYWRFbGVtZW50KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgaW5kZXhPZkxvYWRpbmdBZCA9IHRoaXMuX2xvYWRpbmdBZHMuaW5kZXhPZihhZEVsZW1lbnQpO1xuICAgICAgICB0aGlzLl9sb2FkaW5nQWRzLnNwbGljZShpbmRleE9mTG9hZGluZ0FkLCAxKTsgLy9SZW1vdmUgZnJvbSB0aGUgbG9hZGluZyBhZHMgYXJyYXlcbiAgICB9XG5cbiAgICB0aGlzLl9jaGVja0FsbEFkSW1hZ2VzRG9uZSgpO1xufTtcblxuLyoqXG4gKiBDaGVja3MgaWYgYWxsIGFkIGltYWdlcyBhcmUgZG9uZSBsb2FkaW5nIGFuZCBlbWl0cyBhbiBldmVudCB0aGF0IGFsbCBhZHMgYXJlIHJlYWR5XG4gKiBAcHJpdmF0ZVxuICovXG5BZE1hbmFnZXIucHJvdG90eXBlLl9jaGVja0FsbEFkSW1hZ2VzRG9uZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoKHRoaXMuX2Fkc1dpdGhvdXRJbWFnZXMubGVuZ3RoID09PSAwICYmIHRoaXMuX2xvYWRpbmdBZHMubGVuZ3RoID09PSAwKSB8fCB0aGlzLl9sb2FkaW5nQWRzLmxlbmd0aCA9PT0gdGhpcy5fYWRzV2l0aG91dEltYWdlcy5sZW5ndGgpIHtcbiAgICAgICAgbG9nZ2VyLmluZm8oXCJBbGwgYWRzIGFuZCBpbWFnZXMgYXJlIGRvbmUgbG9hZGluZ1wiKTtcbiAgICAgICAgdmFyIGV2ZW50TGlzdGVuZXJzID0gZXZlbnRzLmdldExpc3RlbmVycyhldmVudHMuZXZlbnRzLmFmdGVyQWRzSW5zZXJ0ZWQpO1xuICAgICAgICBpZiAoZXZlbnRMaXN0ZW5lcnMgJiYgZXZlbnRMaXN0ZW5lcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGV2ZW50TGlzdGVuZXJzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgZXZlbnRMaXN0ZW5lcnNbal0odGhpcy5fY3VycmVudEFkcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5cbm1vZHVsZS5leHBvcnRzID0gQWRNYW5hZ2VyOyIsIi8qKlxuICogQ3JlYXRlZCBieSBuaWVrIG9uIDEzLzA0LzE2LlxuICpcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGFkcyB0byB0aGUgbGlicmFyeVxuICovXG52YXIgYWpheCA9IHJlcXVpcmUoJy4uL3V0aWwvYWpheCcpO1xudmFyIHBhZ2UgPSByZXF1aXJlKCcuLi9wYWdlJyk7XG52YXIgbG9nZ2VyID0gcmVxdWlyZSgnLi4vdXRpbC9sb2dnZXInKTtcbnZhciBhcHBTZXR0aW5ncyA9IHJlcXVpcmUoJy4uL2FwcFNldHRpbmdzJyk7XG5cbi8qKlxuICogR2V0IHRoZSBudW1iZXIgb2YgYWRzIHRoaXMgdW5pdCBuZWVkcyB0byBwbGFjZSBhbGwgdGhlIGFkcyBvbiB0aGUgcGFnZVxuICogQHBhcmFtIGFkVW5pdCBUaGUgYWQgdW5pdCB0byBnZXQgdGhlIHJlcXVpcmVkIG51bWJlciBvZiBhZHMgZm9yXG4gKiBAcmV0dXJucyB7bnVtYmVyfSB0aGUgbnVtYmVyIG9mIHJlcXVpcmVkIGFkc1xuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gX2dldFJlcXVpcmVkQWRDb3VudEZvckFkVW5pdChhZFVuaXQpIHtcbiAgICB2YXIgYWRDb250YWluZXJzID0gcGFnZS5nZXRBZENvbnRhaW5lcnMoYWRVbml0KTtcblxuICAgIGlmICghYWRDb250YWluZXJzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICB2YXIgbnVtYmVyT2ZBZHNUb0luc2VydCA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhZENvbnRhaW5lcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGFkQ29udGFpbmVyID0gYWRDb250YWluZXJzW2ldO1xuICAgICAgICBudW1iZXJPZkFkc1RvSW5zZXJ0ICs9IGFkQ29udGFpbmVyLmdldE51bWJlck9mQWRzVG9JbnNlcnQoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVtYmVyT2ZBZHNUb0luc2VydDtcbn1cblxuLyoqXG4gKiBSZXF1ZXN0IGFkcyBmcm9tIHRoZSBvZmZlckVuZ2luZVxuICogQHBhcmFtIGFkVW5pdCAtIFRoZSBhZCBVbml0IHRoYXQgaXMgcmVxdWVzdGluZyBhZHNcbiAqIEBwYXJhbSBjYWxsYmFjayAtIFRoZSBjYWxsYmFjayB0byBleGVjdXRlIGNvbnRhaW5pbmcgdGhlIGFkc1xuICovXG5mdW5jdGlvbiByZXF1ZXN0QWRzKGFkVW5pdCwgY2FsbGJhY2spIHtcbiAgICB2YXIgbGltaXQgPSBfZ2V0UmVxdWlyZWRBZENvdW50Rm9yQWRVbml0KGFkVW5pdCk7XG4gICAgdmFyIHRva2VuID0gcGFnZS5nZXRUb2tlbigpO1xuXG4gICAgdmFyIHJlcXVlc3RRdWVyeSA9IHtcbiAgICAgICAgXCJvdXRwdXRcIjogXCJqc29uXCIsXG4gICAgICAgIFwicGxhY2VtZW50X2tleVwiOiBhZFVuaXQucGxhY2VtZW50S2V5LFxuICAgICAgICBcImxpbWl0XCI6IGxpbWl0LFxuICAgICAgICBcInRva2VuXCI6IHRva2VuLFxuICAgICAgICBcImF1dG9fZGV2aWNlXCI6IDFcbiAgICB9O1xuXG4gICAgLy9ub2luc3BlY3Rpb24gSlNVbnJlc29sdmVkVmFyaWFibGVcbiAgICBpZiAodHlwZW9mIEFETElCX09WRVJSSURFUyAhPT0gXCJ1bmRlZmluZWRcIiAmJiBBRExJQl9PVkVSUklERVMuZm9ybUZhY3Rvcikge1xuICAgICAgICBpZiAoQURMSUJfT1ZFUlJJREVTLnBsYXRmb3JtICYmIEFETElCX09WRVJSSURFUy5mdWxsRGV2aWNlTmFtZSAmJiBBRExJQl9PVkVSUklERVMudmVyc2lvbikge1xuICAgICAgICAgICAgZGVsZXRlIHJlcXVlc3RRdWVyeS5hdXRvX2RldmljZTtcbiAgICAgICAgICAgIHJlcXVlc3RRdWVyeS5vcyA9IEFETElCX09WRVJSSURFUy5wbGF0Zm9ybTtcbiAgICAgICAgICAgIHJlcXVlc3RRdWVyeS5tb2RlbCA9IEFETElCX09WRVJSSURFUy5mdWxsRGV2aWNlTmFtZTtcbiAgICAgICAgICAgIHJlcXVlc3RRdWVyeS52ZXJzaW9uID0gQURMSUJfT1ZFUlJJREVTLnZlcnNpb247XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhamF4LmdldCh7XG4gICAgICAgIHVybDogYXBwU2V0dGluZ3MuYWRBcGlCYXNlVXJsLFxuICAgICAgICBxdWVyeTogcmVxdWVzdFF1ZXJ5LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKGRhdGEubGVuZ3RoICE9PSBsaW1pdCkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKFwiVHJpZWQgdG8gZmV0Y2ggXCIgKyBsaW1pdCArIFwiIGFkcywgYnV0IG9ubHkgcmVjZWl2ZWQgXCIgKyBkYXRhLmxlbmd0aCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKGRhdGEpO1xuICAgICAgICB9LFxuICAgICAgICBlcnJvcjogZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgIGxvZ2dlci53dGYoJ0FuIGVycm9yIG9jY3VycmVkIHRyeWluZyB0byBmZXRjaCBhZHMnKTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVlc3RBZHM7IiwiLyoqXG4gKiBDcmVhdGVkIGJ5IG5pZWsgb24gMTMvMDQvMTYuXG4gKiBUaGlzIG1vZHVsZSB0YWtlcyBjYXJlIG9mIHRoZSBhZCBpbnNlcnRpb24gZm9yIGEgZ2l2ZW4gYWQgdW5pdFxuICovXG52YXIgcGFnZSA9IHJlcXVpcmUoJy4uL3BhZ2UnKTtcbnZhciBBZEJ1aWxkZXIgPSByZXF1aXJlKCcuL2FkQnVpbGRlcicpO1xudmFyIGRldmljZURldGVjdG9yID0gcmVxdWlyZSgnLi4vZGV2aWNlL2RldmljZURldGVjdG9yJyk7XG52YXIgbG9nZ2VyID0gcmVxdWlyZSgnLi4vdXRpbC9sb2dnZXInKTtcblxuLyoqXG4gKiBJbnNlcnQgYWR2ZXJ0aXNlbWVudHMgZm9yIHRoZSBnaXZlbiBhZCB1bml0IG9uIHRoZSBwYWdlXG4gKiBAcGFyYW0gYWRVbml0IC0gVGhlIGFkIHVuaXQgdG8gaW5zZXJ0IGFkdmVydGlzZW1lbnRzIGZvclxuICogQHBhcmFtIGFkcyAtIEFycmF5IG9mIGFkcyByZXRyaWV2ZWQgZnJvbSBPZmZlckVuZ2luZVxuICogQHBhcmFtIGFkTG9hZGVkQ2FsbGJhY2sgLSBDYWxsYmFjayB0byBleGVjdXRlIHdoZW4gdGhlIGFkcyBhcmUgZnVsbHkgbG9hZGVkXG4gKiBAcmV0dXJucyB7QXJyYXl9XG4gKi9cbmZ1bmN0aW9uIGluc2VydEFkcyhhZFVuaXQsIGFkcywgYWRMb2FkZWRDYWxsYmFjaykge1xuICAgIHZhciBhZENvbnRhaW5lcnMgPSBwYWdlLmdldEFkQ29udGFpbmVycyhhZFVuaXQpO1xuXG4gICAgaWYgKCFhZENvbnRhaW5lcnMubGVuZ3RoKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihcIk5vIGFkIGNvbnRhaW5lcnMgY291bGQgYmUgZm91bmQuIHN0b3BwaW5nIGluc2VydGlvbiBmb3IgYWRVbml0IFwiICsgYWRVbml0Lm5hbWUpO1xuICAgICAgICByZXR1cm4gW107IC8vQWQgY2FuJ3QgYmUgaW5zZXJ0ZWRcbiAgICB9XG4gICAgXG4gICAgdmFyIGFkQnVpbGRlciA9IG5ldyBBZEJ1aWxkZXIoYWRzKTtcblxuICAgIHZhciBiZWZvcmVFbGVtZW50O1xuICAgIHZhciBpbnNlcnRlZEFkRWxlbWVudHMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFkQ29udGFpbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgYWRDb250YWluZXIgPSBhZENvbnRhaW5lcnNbaV07XG4gICAgICAgIHdoaWxlICgoYmVmb3JlRWxlbWVudCA9IGFkQ29udGFpbmVyLmdldE5leHRFbGVtZW50KCkpICE9PSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgYWRUb0luc2VydCA9IGFkQnVpbGRlci5jcmVhdGVBZFVuaXQoYWRVbml0LCBhZENvbnRhaW5lci5jb250YWluZXJFbGVtZW50KTtcblxuICAgICAgICAgICAgaWYgKGFkVG9JbnNlcnQgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAvL3dlIHJhbiBvdXQgb2YgYWRzLlxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpbnNlcnRlZEFkRWxlbWVudHMucHVzaChhZFRvSW5zZXJ0KTtcbiAgICAgICAgICAgIGJlZm9yZUVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoYWRUb0luc2VydCwgYmVmb3JlRWxlbWVudC5uZXh0U2libGluZyk7XG5cbiAgICAgICAgICAgIC8vIHZhciBlbGVtZW50RGlzcGxheSA9IGFkVG9JbnNlcnQuc3R5bGUuZGlzcGxheSB8fCBcImJsb2NrXCI7XG4gICAgICAgICAgICAvL1RPRE86IFdoeSBhcmUgd2UgZGVmYXVsdGluZyB0byBibG9jayBoZXJlP1xuICAgICAgICAgICAgLy8gYWRUb0luc2VydC5zdHlsZS5kaXNwbGF5ID0gZWxlbWVudERpc3BsYXk7XG4gICAgICAgICAgICBoYW5kbGVJbWFnZUxvYWQoYWRUb0luc2VydCwgYWRMb2FkZWRDYWxsYmFjayk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaW5zZXJ0ZWRBZEVsZW1lbnRzO1xufVxuXG4vKipcbiAqIEFkZCBhbiBldmVudCBoYW5kbGVyIHRvIHRoZSBvbmxvYWQgb2YgYWQgaW1hZ2VzLlxuICogQHBhcmFtIGFkRWxlbWVudCAtIFRoZSBIVE1MIGVsZW1lbnQgb2YgdGhlIGFkdmVydGlzZW1lbnRcbiAqIEBwYXJhbSBhZExvYWRlZENhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gZXhlY3V0ZSB3aGVuIGFkcyBhcmUgbG9hZGVkXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZUltYWdlTG9hZChhZEVsZW1lbnQsIGFkTG9hZGVkQ2FsbGJhY2spIHtcbiAgICB2YXIgYWRJbWFnZSA9IGFkRWxlbWVudC5xdWVyeVNlbGVjdG9yKFwiaW1nXCIpO1xuICAgIGlmIChhZEltYWdlKSB7XG4gICAgICAgIChmdW5jdGlvbiAoYWRUb0luc2VydCwgYWRJbWFnZSkge1xuICAgICAgICAgICAgYWRJbWFnZS5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgYWRMb2FkZWRDYWxsYmFjayhhZFRvSW5zZXJ0LCB0cnVlKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0pKGFkRWxlbWVudCwgYWRJbWFnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgYWRMb2FkZWRDYWxsYmFjayhhZEVsZW1lbnQsIGZhbHNlKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaW5zZXJ0QWRzOyIsIi8qKlxuICogQ3JlYXRlZCBieSBOaWVrS3J1c2Ugb24gMTAvNS8xNS5cbiAqIFRoaXMgbW9kdWxlIGNvbnRhaW5zIGxpYnJhcnkgd2lkZSBkZWJ1ZyBzZXR0aW5nc1xuICogQSBtb2R1bGUgdGhhdCBleHBvc2VzIHRoZSBhcHAgc2V0dGluZ3NcbiAqL1xudmFyIGVudW1lcmF0aW9ucyA9IHJlcXVpcmUoXCIuL3V0aWwvZW51bWVyYXRpb25zXCIpO1xuXG4vKipcbiAqIEV4cG9ydHMgdGhlIGFwcFNldHRpbmdzXG4gKi9cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNvbmZpZ0ZpbGVOYW1lOiBcIi9hZGNvbmZpZy5qc29uXCIsXG4gICAgaXNEZWJ1ZzogZmFsc2UsXG4gICAgbG9nTGV2ZWw6IGVudW1lcmF0aW9ucy5sb2dMZXZlbC5kZWJ1ZyxcbiAgICBhZEFwaUJhc2VVcmw6IFwiIGh0dHA6Ly9vZmZlcndhbGwuMTJ0cmFja3dheS5jb20vb3cucGhwXCIsXG4gICAgZ2xvYmFsVmFyTmFtZTogXCJwb2NrZXRfbmF0aXZlX2Fkc1wiLFxuICAgIHhEb21haW5TdG9yYWdlVVJMOiBcIiBodHRwOi8vb2ZmZXJ3YWxsLjEydHJhY2t3YXkuY29tL3hEb21haW5TdG9yYWdlLmh0bWxcIixcbiAgICB0b2tlbkNvb2tpZUtleTogXCJwbV9vZmZlcndhbGxcIixcbiAgICBsb2dnZXJWYXI6IFwiX19hZGxpYkxvZ1wiLFxuICAgIGRlZmF1bHRTbWFydFBob25lV2lkdGg6IDM3NSxcbiAgICBkZWZhdWx0VGFibGV0V2lkdGg6IDc2OCxcbiAgICBjb25maWd1cmF0aW9uc0FwaVVybDogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMC9hZHVuaXRzJywgLy8gVE9ETzogY2hhbmdlIHRvIE9mZmVyRW5naW5lIHNlcnZlclxuICAgIGFwcGxpY2F0aW9uSWRBdHRyaWJ1dGU6ICdkYXRhLWFwcGxpY2F0aW9uLWlkJyxcbiAgICBhZEVsZW1lbnRDbGFzc25hbWU6ICdwbV9uYXRpdmVfYWRfdW5pdCcsXG4gICAgZGlzcGxheVNldHRpbmdzOiB7XG4gICAgICAgIG1vYmlsZToge1xuICAgICAgICAgICAgbWluV2lkdGg6IDAsXG4gICAgICAgICAgICBtYXhXaWR0aDogNDE1XG4gICAgICAgIH0sXG4gICAgICAgIHRhYmxldDoge1xuICAgICAgICAgICAgbWluV2lkdGg6IDQxNSxcbiAgICAgICAgICAgIG1heFdpZHRoOiAxMDI0XG4gICAgICAgIH1cbiAgICB9XG59O1xuIiwiLyoqXG4gKiBDcmVhdGVkIGJ5IE5pZWtLcnVzZSBvbiAxMC85LzE1LlxuICpcbiAqIFRoaXMgbW9kdWxlIGNvbnRhaW5zIGZ1bmN0aW9uYWxpdHkgZm9yIGRldGVjdGluZyBkZXRhaWxzIGFib3V0IGEgZGV2aWNlXG4gKi9cbnZhciBhcHBTZXR0aW5ncyA9IHJlcXVpcmUoJy4uL2FwcFNldHRpbmdzJyksXG4gICAgRGV2aWNlRW51bWVyYXRpb25zID0gcmVxdWlyZSgnLi4vZGV2aWNlL2VudW1lcmF0aW9ucycpO1xuXG4vKipcbiAqIENoZWNrIGlmIHRoZSBwbGF0Zm9ybSB0aGUgdXNlciBpcyBjdXJyZW50bHkgdmlzaXRpbmcgdGhlIHBhZ2Ugd2l0aCBpcyB2YWxpZCBmb3JcbiAqIHRoZSBhZCBsaWJyYXJ5IHRvIHJ1blxuICogQHJldHVybnMge2Jvb2xlYW59XG4gKi9cbmZ1bmN0aW9uIGlzVmFsaWRQbGF0Zm9ybSgpIHtcbiAgICBpZiAodHlwZW9mIEFETElCX09WRVJSSURFUyAhPT0gXCJ1bmRlZmluZWRcIiAmJiBBRExJQl9PVkVSUklERVMucGxhdGZvcm0pIHtcbiAgICAgICAgcmV0dXJuIHRydWU7IC8vSWYgYSBwbGF0Zm9ybSBvdmVycmlkZSBpcyBzZXQsIGl0J3MgYWx3YXlzIHZhbGlkXG4gICAgfVxuICAgIHJldHVybiAvaVBob25lfGlQYWR8aVBvZHxBbmRyb2lkL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcbn1cblxuLyoqXG4gKiBEZXRlY3RzIHRoZSBkZXZpY2UgZm9ybSBmYWN0b3IgYmFzZWQgb24gdGhlIFZpZXdQb3J0IGFuZCB0aGUgZGV2aWNlV2lkdGhzIGluIEFwcFNldHRpbmdzXG4gKiBUaGUgdGVzdF9vbGQgaXMgZG9uZSBiYXNlZCBvbiB0aGUgdmlld3BvcnQsIGJlY2F1c2UgaXQgaXMgYWxyZWFkeSB2YWxpZGF0ZWQgdGhhdCBhIGRldmljZSBpcyBBbmRyb2lkIG9yIGlPU1xuICogQHJldHVybnMgeyp9IHRoZSBmb3JtIGZhY3RvciBvZiB0aGUgZGV2aWNlXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBkZXRlY3RGb3JtRmFjdG9yKCkge1xuICAgIHZhciB2aWV3UG9ydFdpZHRoID0gTWF0aC5tYXgoZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudFdpZHRoLCB3aW5kb3cuaW5uZXJXaWR0aCB8fCAwKTtcblxuICAgIHZhciBkaXNwbGF5U2V0dGluZ3MgPSBhcHBTZXR0aW5ncy5kaXNwbGF5U2V0dGluZ3M7IC8vY29udmVuaWVuY2UgdmFyaWFibGVcbiAgICB2YXIgZm9ybUZhY3RvcjtcblxuICAgIGlmICh2aWV3UG9ydFdpZHRoID49IGRpc3BsYXlTZXR0aW5ncy5tb2JpbGUubWluV2lkdGggJiYgdmlld1BvcnRXaWR0aCA8PSBkaXNwbGF5U2V0dGluZ3MubW9iaWxlLm1heFdpZHRoKSB7XG4gICAgICAgIGZvcm1GYWN0b3IgPSBEZXZpY2VFbnVtZXJhdGlvbnMuZm9ybUZhY3Rvci5zbWFydFBob25lO1xuICAgIH0gZWxzZSBpZiAodmlld1BvcnRXaWR0aCA+PSBkaXNwbGF5U2V0dGluZ3MudGFibGV0Lm1pbldpZHRoICYmIHZpZXdQb3J0V2lkdGggPD0gZGlzcGxheVNldHRpbmdzLnRhYmxldC5tYXhXaWR0aCkge1xuICAgICAgICBmb3JtRmFjdG9yID0gRGV2aWNlRW51bWVyYXRpb25zLmZvcm1GYWN0b3IudGFibGV0O1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGZvcm1GYWN0b3IgPSBEZXZpY2VFbnVtZXJhdGlvbnMuZm9ybUZhY3Rvci5kZXNrdG9wO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JtRmFjdG9yO1xufVxuXG52YXIgY2FjaGUgPSBudWxsO1xubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgZ2V0RGV2aWNlRGV0YWlsczogZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmKGNhY2hlKSByZXR1cm4gY2FjaGU7XG5cbiAgICAgICAgdmFyIGZvcm1GYWN0b3IgPSBkZXRlY3RGb3JtRmFjdG9yKCk7XG4gICAgICAgIGlmICh0eXBlb2YgQURMSUJfT1ZFUlJJREVTICE9PSBcInVuZGVmaW5lZFwiICYmIEFETElCX09WRVJSSURFUy5mb3JtRmFjdG9yKSB7XG4gICAgICAgICAgICAgICAgZm9ybUZhY3RvciA9IEFETElCX09WRVJSSURFUy5mb3JtRmFjdG9yO1xuICAgICAgICB9XG4gICAgICAgIGNhY2hlID0ge1xuICAgICAgICAgICAgZm9ybUZhY3RvcjogZm9ybUZhY3RvcixcbiAgICAgICAgICAgIGlzVmFsaWRQbGF0Zm9ybTogaXNWYWxpZFBsYXRmb3JtKClcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gY2FjaGU7XG4gICAgfVxufTtcblxuXG5cbi8vTk9URTogV2UgYXJlIG5vdCB1c2luZyBwbGF0Zm9ybSBkZXRlY3Rpb24gZm9yIGFueXRoaW5nIHJpZ2h0IG5vdyBhcyB0aGUgT2ZmZXJFbmdpbmUgZG9lcyBhdXRvbWF0aWMgZGV2aWNlIGRldGVjdGlvbixcbi8vIGJ1dCB3ZSBtaWdodCBuZWVkIGl0IGxhdGVyLCBzbyBpdCdzIGNvbW1lbnRlZCBvdXQuIChjb21tZW50cyBhcmVuJ3QgaW5jbHVkZWQgaW4gbWluaWZpZWQgYnVpbGQpXG5cbi8vIC8qKlxuLy8gICogRGV0ZWN0cyB0aGUgcGxhdGZvcm0gb2YgdGhlIGRldmljZVxuLy8gICogQHJldHVybnMge3N0cmluZ30gdGhlIHBsYXRmb3JtIG9mIHRoZSBkZXZpY2Vcbi8vICAqL1xuLy8gRGV2aWNlRGV0ZWN0b3IucHJvdG90eXBlLmRldGVjdFBsYXRmb3JtID0gZnVuY3Rpb24gKCkge1xuLy8gICAgIGlmICh0aGlzLnBsYXRmb3JtKSB7XG4vLyAgICAgICAgIHJldHVybiB0aGlzLnBsYXRmb3JtO1xuLy8gICAgIH1cbi8vXG4vLyAgICAgdmFyIHBsYXRmb3JtO1xuLy8gICAgIGlmICgvQW5kcm9pZC9pLnRlc3Rfb2xkKHRoaXMudXNlckFnZW50U3RyaW5nKSkge1xuLy8gICAgICAgICBwbGF0Zm9ybSA9IERldmljZUVudW1lcmF0aW9ucy5wbGF0Zm9ybS5hbmRyb2lkO1xuLy8gICAgIH0gZWxzZSBpZiAoL2lQaG9uZXxpUGFkfGlQb2QvaS50ZXN0X29sZCh0aGlzLnVzZXJBZ2VudFN0cmluZykpIHtcbi8vICAgICAgICAgcGxhdGZvcm0gPSBEZXZpY2VFbnVtZXJhdGlvbnMucGxhdGZvcm0uaU9TO1xuLy8gICAgIH0gZWxzZSB7XG4vLyAgICAgICAgIHBsYXRmb3JtID0gRGV2aWNlRW51bWVyYXRpb25zLnBsYXRmb3JtLm90aGVyO1xuLy8gICAgIH1cbi8vXG4vL1xuLy8gICAgIHRoaXMucGxhdGZvcm0gPSBwbGF0Zm9ybTtcbi8vICAgICByZXR1cm4gdGhpcy5wbGF0Zm9ybTtcbi8vIH07XG5cbiIsIi8qKlxuICogQ3JlYXRlZCBieSBOaWVrS3J1c2Ugb24gMTAvOS8xNS5cbiAqXG4gKiBNb2R1bGUgY29udGFpbnMgZGV2aWNlIHJlbGF0ZWQgZW51bWVyYXRpb25zXG4gKi9cbnZhciBlbnVtZXJhdGlvbnMgPSB7fTtcbmVudW1lcmF0aW9ucy5mb3JtRmFjdG9yID0ge1xuICAgIGRlc2t0b3A6IFwiZGVza3RvcFwiLFxuICAgIGFwcDogXCJhcHBcIixcbiAgICB0YWJsZXQ6IFwidGFibGV0XCIsXG4gICAgc21hcnRQaG9uZTogXCJtb2JpbGVcIlxufTtcblxuZW51bWVyYXRpb25zLnBsYXRmb3JtID0ge1xuICAgIGFuZHJvaWQ6IFwiQW5kcm9pZFwiLFxuICAgIGlPUzogXCJpT1NcIixcbiAgICBvdGhlcjogXCJvdGhlclwiXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGVudW1lcmF0aW9ucztcbiIsInZhciByZXNvbHZlVG9rZW5GdW5jdGlvbiA9IHJlcXVpcmUoJy4uL3V0aWwvcmVzb2x2ZVRva2VuJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGdldFBhdGhuYW1lOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWU7XG4gICAgfSxcbiAgICBzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgIH0sXG4gICAgcmVzb2x2ZVRva2VuOiByZXNvbHZlVG9rZW5GdW5jdGlvblxufTsiLCIvKipcbiAqIENyZWF0ZWQgYnkgTmlla0tydXNlIG9uIDEvMjAvMTYuXG4gKlxuICogTW9kdWxlIGZvciBhZGRpbmcgYW5kIHJlbW92aW5nIGV2ZW50IGxpc3RlbmVyc1xuICovXG5cbi8qKlxuICogQGVudW0ge3N0cmluZ31cbiAqL1xudmFyIGV2ZW50cyA9IHtcbiAgICBhZnRlckFkc0luc2VydGVkOiBcImFmdGVyQWRzSW5zZXJ0ZWRcIlxufTtcbnZhciBsaXN0ZW5lcnMgPSB7fTtcblxuLyoqXG4gKiBDaGVjayBpZiB0aGUgZXZlbnQgcGFzc2VkIGlzIHZhbGlkXG4gKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lIC0gTmFtZSBvZiB0aGUgZXZlbnRcbiAqL1xuZnVuY3Rpb24gY2hlY2tFdmVudFZhbGlkKGV2ZW50TmFtZSkge1xuICAgIGlmICghZXZlbnRzLmhhc093blByb3BlcnR5KGV2ZW50TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgZXZlbnROYW1lICsgXCIgaXMgbm90IGEgdmFsaWQgZXZlbnQgbGlzdGVuZXJcIjtcbiAgICB9XG59XG5cbi8qKlxuICogQWRkIGEgbmV3IGV2ZW50IGxpc3RlbmVyXG4gKiBAcGFyYW0ge2V2ZW50c30gZXZlbnQgLSBUaGUgbmFtZSBvZiB0aGUgZXZlbnQgbGlzdGVuZXIgdG8gYWRkIGFuIGV2ZW50IGZvclxuICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgLSBUaGUgY2FsbGJhY2sgdG8gaW52b2tlIHdoZW4gdGhlIGV2ZW50IGlzIGNhbGxlZFxuICovXG5mdW5jdGlvbiBhZGRMaXN0ZW5lcihldmVudCwgY2FsbGJhY2spIHtcbiAgICBjaGVja0V2ZW50VmFsaWQoZXZlbnQpO1xuXG4gICAgaWYgKGxpc3RlbmVyc1tldmVudF0pIHtcbiAgICAgICAgbGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsaXN0ZW5lcnNbZXZlbnRdID0gW2NhbGxiYWNrXTtcbiAgICB9XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgY2VydGFpbiBldmVudCBsaXN0ZW5lclxuICogQHBhcmFtIHtldmVudHN9IGV2ZW50IC0gVGhlIG5hbWUgb2YgdGhlIGV2ZW50IHRvIGxpc3RlbiB0b1xuICogQHBhcmFtIHtmdW5jdGlvbn0gZXZlbnRIYW5kbGVyIC0gVGhlIGV2ZW50SGFuZGxlciB0aGF0IGlzIGJvdW5kIHRvIHRoaXMgbGlzdGVuZXIgYW5kIHNob3VsZCBiZSByZW1vdmVkXG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUxpc3RlbmVyKGV2ZW50LCBldmVudEhhbmRsZXIpIHtcbiAgICBjaGVja0V2ZW50VmFsaWQoZXZlbnQpO1xuXG4gICAgaWYgKGxpc3RlbmVyc1tldmVudF0gJiYgbGlzdGVuZXJzW2V2ZW50XS5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGluZGV4T2ZMaXN0ZW5lciA9IGxpc3RlbmVyc1tldmVudF0uaW5kZXhPZihldmVudEhhbmRsZXIpO1xuICAgICAgICBpZiAoaW5kZXhPZkxpc3RlbmVyID4gLTEpIHtcbiAgICAgICAgICAgIGxpc3RlbmVyc1tldmVudF0uc3BsaWNlKGluZGV4T2ZMaXN0ZW5lciwgMSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogR2V0IHRoZSBldmVudCBoYW5kbGVycyBmb3IgYSBjZXJ0YWluIGV2ZW50XG4gKiBAcGFyYW0ge2V2ZW50c30gZXZlbnROYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGV2ZW50IHRvIGdldCBsaXN0ZW5lcnMgZm9yXG4gKi9cbmZ1bmN0aW9uIGdldExpc3RlbmVycyhldmVudE5hbWUpIHtcbiAgICByZXR1cm4gbGlzdGVuZXJzW2V2ZW50TmFtZV07XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGV2ZW50czogZXZlbnRzLFxuICAgIGFkZExpc3RlbmVyOiBhZGRMaXN0ZW5lcixcbiAgICByZW1vdmVMaXN0ZW5lcjogcmVtb3ZlTGlzdGVuZXIsXG4gICAgZ2V0TGlzdGVuZXJzOiBnZXRMaXN0ZW5lcnNcbn07IiwiLyoqXG4gKiBNYWluIGVudHJ5IHBvaW50IGZvciB0aGUgYWQgbGlicmFyeS5cbiAqL1xudmFyIGRldmljZURldGFpbHMgPSByZXF1aXJlKCcuL2RldmljZS9kZXZpY2VEZXRlY3RvcicpLmdldERldmljZURldGFpbHMoKSxcbiAgICBlbnZpcm9ubWVudCA9IHJlcXVpcmUoJy4vZW52L2Vudmlyb25tZW50JyksXG4gICAgQWRMaWIgPSByZXF1aXJlKCcuL2FkTGliJyksXG4gICAgbG9nZ2VyID0gcmVxdWlyZSgnLi91dGlsL2xvZ2dlcicpLFxuICAgIGFwcFNldHRpbmdzID0gcmVxdWlyZShcIi4vYXBwU2V0dGluZ3NcIik7XG5cbnZhciBpc0luaXRpYWxpemVkID0gZmFsc2U7XG5cbndpbmRvd1thcHBTZXR0aW5ncy5nbG9iYWxWYXJOYW1lXSA9IHtyZWFkeTogZmFsc2V9O1xuXG5mdW5jdGlvbiBpbml0QWRMaWIob3B0aW9ucykge1xuICAgIHZhciBhZExpYiA9IG5ldyBBZExpYihlbnZpcm9ubWVudCwgb3B0aW9ucyk7XG4gICAgYWRMaWIuaW5pdCgpO1xuICAgIGlzSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgIHdpbmRvd1thcHBTZXR0aW5ncy5nbG9iYWxWYXJOYW1lXS5pbml0ID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gZ2V0QXBwbGljYXRpb25JZCgpIHtcbiAgICB2YXIgYXBwbGljYXRpb25JZCA9IG51bGw7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cuQURMSUJfT1ZFUlJJREVTICE9PSBcInVuZGVmaW5lZFwiICYmIHdpbmRvdy5BRExJQl9PVkVSUklERVMuYXBwbGljYXRpb25JZCkge1xuICAgICAgICBhcHBsaWNhdGlvbklkID0gd2luZG93LkFETElCX09WRVJSSURFUy5hcHBsaWNhdGlvbklkO1xuICAgIH1cbiAgICB2YXIgc2NyaXB0VGFnID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcInNjcmlwdFtcIiArIGFwcFNldHRpbmdzLmFwcGxpY2F0aW9uSWRBdHRyaWJ1dGUgKyBcIl1cIik7XG4gICAgaWYgKHNjcmlwdFRhZykge1xuICAgICAgICBhcHBsaWNhdGlvbklkID0gc2NyaXB0VGFnLmdldEF0dHJpYnV0ZShhcHBTZXR0aW5ncy5hcHBsaWNhdGlvbklkQXR0cmlidXRlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXBwbGljYXRpb25JZDtcbn1cblxuaWYgKCFpc0luaXRpYWxpemVkICYmIGRldmljZURldGFpbHMuaXNWYWxpZFBsYXRmb3JtKSB7XG4gICAgbG9nZ2VyLmluZm8oJ0luaXRpYWxpemluZyBuYXRpdmUgYWRzIGxpYnJhcnknKTtcbiAgICB2YXIgYXBwbGljYXRpb25JZCA9IGdldEFwcGxpY2F0aW9uSWQoKTtcbiAgICBpZiAoYXBwbGljYXRpb25JZCkge1xuICAgICAgICBpbml0QWRMaWIoe1xuICAgICAgICAgICAgYXBwbGljYXRpb25JZDogYXBwbGljYXRpb25JZFxuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB3aW5kb3dbYXBwU2V0dGluZ3MuZ2xvYmFsVmFyTmFtZV0uaW5pdCA9IGluaXRBZExpYjtcbiAgICB9XG59IiwiLyoqXG4gKiBDcmVhdGVkIGJ5IE5pZWtLcnVzZSBvbiAxMC8xNC8xNS5cbiAqIE1vZHVsZSB0aGF0IGNvbnRhaW5zIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjdXJyZW50IHBhZ2VcbiAqIEBtb2R1bGUgcGFnZVxuICovXG52YXIgbG9nZ2VyID0gcmVxdWlyZShcIi4vdXRpbC9sb2dnZXJcIiksXG4gICAgdXRpbHMgPSByZXF1aXJlKFwiLi91dGlsc1wiKSxcbiAgICBBZENvbnRhaW5lciA9IHJlcXVpcmUoXCIuL2Fkcy9hZENvbnRhaW5lclwiKTtcblxuLyoqXG4gKiBDYWNoZWQgdmVyc2lvbiBvZiB0aGUgdG9rZW5cbiAqIEB0eXBlIHtzdHJpbmd8bnVsbH1cbiAqL1xudmFyIHRva2VuID0gbnVsbDtcbnZhciBpc1ByZWxvYWRpbmdUb2tlbiA9IGZhbHNlO1xuXG4vL0tlZXAgYW4gYXJyYXkgY29udGFpbmluZyBjYWxsYmFja3MgdGhhdCBzaG91bGQgZmlyZSB3aGVuIHRoZSBwYWdlIGlzIHJlYWR5XG52YXIgY2FsbGJhY2tzT25SZWFkeSA9IFtdO1xuXG4vKipcbiAqIEV2YWx1YXRlcyB4UGF0aCBvbiBhIHBhZ2VcbiAqIEBwYXJhbSB7c3RyaW5nfSB4UGF0aFN0cmluZyAtIFRoZSBYcGF0aCBzdHJpbmcgdG8gZXZhbHVhdGVcbiAqIEByZXR1cm5zIHtBcnJheS48SFRNTEVsZW1lbnQ+fSAtIEFuIGFycmF5IG9mIHRoZSBmb3VuZCBIVE1MIGVsZW1lbnRzXG4gKi9cbmZ1bmN0aW9uIHhQYXRoKHhQYXRoU3RyaW5nKSB7XG4gICAgdmFyIHhSZXN1bHQgPSBkb2N1bWVudC5ldmFsdWF0ZSh4UGF0aFN0cmluZywgZG9jdW1lbnQsIG51bGwsIDAsIG51bGwpO1xuICAgIHZhciB4Tm9kZXMgPSBbXTtcbiAgICB2YXIgeFJlcyA9IHhSZXN1bHQuaXRlcmF0ZU5leHQoKTtcbiAgICB3aGlsZSAoeFJlcykge1xuICAgICAgICB4Tm9kZXMucHVzaCh4UmVzKTtcbiAgICAgICAgeFJlcyA9IHhSZXN1bHQuaXRlcmF0ZU5leHQoKTtcbiAgICB9XG5cbiAgICByZXR1cm4geE5vZGVzO1xufVxuXG5cbi8qKlxuICogQ2hlY2sgaWYgdGhlIGVudGlyZSBwYWdlIGlzIHJlYWR5XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIGlmIHRoZSBwYWdlIGlzIHJlYWR5LCBmYWxzZSBpZiBpdCBpc24ndC5cbiAqL1xuZnVuY3Rpb24gaXNSZWFkeSgpIHtcbiAgICB2YXIgZG9tUmVhZHkgPSBkb2N1bWVudC5yZWFkeVN0YXRlICE9PSAnbG9hZGluZyc7XG4gICAgdmFyIHRva2VuUmVhZHkgPSB0b2tlbiAhPT0gbnVsbDtcblxuICAgIHJldHVybiAoZG9tUmVhZHkgJiYgdG9rZW5SZWFkeSk7XG59XG5cbi8qKlxuICogRXhlY3V0ZSBhbGwgdGhlIGZ1bmN0aW9ucyB0aGF0IGFyZSB3YWl0aW5nIGZvciB0aGUgcGFnZSB0byBmaW5pc2ggbG9hZGluZ1xuICovXG5mdW5jdGlvbiBleGVjV2FpdFJlYWR5RnVuY3Rpb25zKCkge1xuICAgIGlmIChpc1JlYWR5KCkpIHtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ1BhZ2UgaXMgcmVhZHkuIEV4ZWN1dGluZyAnICsgY2FsbGJhY2tzT25SZWFkeS5sZW5ndGggKyAnIGZ1bmN0aW9ucyB0aGF0IGFyZSB3YWl0aW5nLicpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNhbGxiYWNrc09uUmVhZHkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjYWxsYmFjayA9IGNhbGxiYWNrc09uUmVhZHlbaV07XG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwcmVsb2FkVG9rZW4gKGVudmlyb25tZW50KSB7XG4gICAgaXNQcmVsb2FkaW5nVG9rZW4gPSB0cnVlO1xuICAgIGVudmlyb25tZW50LnJlc29sdmVUb2tlbihmdW5jdGlvbiAodXNlclRva2VuKSB7XG4gICAgICAgIHRva2VuID0gdXNlclRva2VuO1xuICAgICAgICBsb2dnZXIuaW5mbygnVXNlciB0cmFja2luZyB0b2tlbiByZXNvbHZlZCcpO1xuICAgICAgICBleGVjV2FpdFJlYWR5RnVuY3Rpb25zKCk7XG4gICAgfSk7XG59XG5cbi8qKlxuICogUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBwYWdlIGlzIHJlYWR5XG4gKiBAcGFyYW0gZnVuY1RvRXhlY3V0ZSAtIFRoZSBmdW5jdGlvbiB0byBleGVjdXRlIHdoZW4gdGhlIHBhZ2UgaXMgbG9hZGVkXG4gKi9cbmZ1bmN0aW9uIHdoZW5SZWFkeShmdW5jVG9FeGVjdXRlKSB7XG4gICAgaWYgKGlzUmVhZHkoKSkge1xuICAgICAgICBsb2dnZXIuaW5mbygnUGFnZSBpcyBhbHJlYWR5IGxvYWRlZCwgaW5zdGFudGx5IGV4ZWN1dGluZyEnKTtcbiAgICAgICAgZnVuY1RvRXhlY3V0ZSgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbG9nZ2VyLmluZm8oJ1dhaXRpbmcgZm9yIHBhZ2UgdG8gYmUgcmVhZHknKTtcbiAgICBjYWxsYmFja3NPblJlYWR5LnB1c2goZnVuY1RvRXhlY3V0ZSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIC8qKlxuICAgICAqIENoZWNrIHdoZXRoZXIgdGhlIHBhZ2UgaGFzIHJlc3BvbnNpdmUgZGVzaWduXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IGluZGljYXRpbmcgd2hldGhlciBwYWdlIGlzIHJlc3BvbnNpdmUgb3Igbm90XG4gICAgICovXG4gICAgaXNSZXNwb25zaXZlOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciB2aWV3UG9ydE1ldGFUYWcgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwibWV0YVtuYW1lPXZpZXdwb3J0XVwiKTtcbiAgICAgICAgcmV0dXJuICh2aWV3UG9ydE1ldGFUYWcgIT09IG51bGwpO1xuICAgIH0sXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgYWRjb250YWluZXJzIG9uIHRoZSBwYWdlIGZyb20gdGhlIGNvbnRhaW5lciB4UGF0aFxuICAgICAqIEBwYXJhbSBhZFVuaXRTZXR0aW5ncyB0aGUgc2V0dGluZ3MgZm9yIHRoZSBhZFVuaXQgdG8gZ2V0IHRoZSBjb250YWluZXIgb2ZcbiAgICAgKiBAcmV0dXJucyB7QXJyYXkuPE9iamVjdD59IHRoZSBBZENvbnRhaW5lciBvYmplY3Qgb3IgbnVsbCBpZiBub3QgZm91bmRcbiAgICAgKi9cbiAgICBnZXRBZENvbnRhaW5lcnM6IGZ1bmN0aW9uIChhZFVuaXRTZXR0aW5ncykge1xuICAgICAgICB2YXIgY29udGFpbmVycyA9IGFkVW5pdFNldHRpbmdzLmNvbnRhaW5lcnM7XG5cbiAgICAgICAgdmFyIGFkQ29udGFpbmVycyA9IFtdO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY29udGFpbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGNvbnRhaW5lciA9IGNvbnRhaW5lcnNbaV07XG5cbiAgICAgICAgICAgIHZhciBjb250YWluZXJYUGF0aCA9IGNvbnRhaW5lci54UGF0aDtcbiAgICAgICAgICAgIHZhciBhZENvbnRhaW5lckVsZW1lbnRzID0geFBhdGgoY29udGFpbmVyWFBhdGgpO1xuXG4gICAgICAgICAgICBpZiAoIWFkQ29udGFpbmVyRWxlbWVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oXCJBZCBjb250YWluZXIgd2l0aCB4UGF0aDogXFxcIlwiICsgY29udGFpbmVyWFBhdGggKyBcIlxcXCIgY291bGQgbm90IGJlIGZvdW5kIG9uIHBhZ2VcIik7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhZENvbnRhaW5lckVsZW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihcIkFkIGNvbnRhaW5lciB3aXRoIHhQYXRoOiAgXFxcIlwiICsgY29udGFpbmVyWFBhdGggKyBcIlxcXCIgaGFzIG11bHRpcGxlIG1hdGNoZXNcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGFkQ29udGFpbmVycy5wdXNoKG5ldyBBZENvbnRhaW5lcihjb250YWluZXIsIGFkQ29udGFpbmVyRWxlbWVudHNbMF0pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhZENvbnRhaW5lcnM7XG4gICAgfSxcbiAgICAvKipcbiAgICAgKiByZW1vdmUgYW4gZWxlbWVudCBmcm9tIHRoZSBkb21cbiAgICAgKiBAcGFyYW0gZG9tTm9kZSB0aGUgZWxlbWVudCB0byByZW1vdmVcbiAgICAgKi9cbiAgICByZW1vdmVFbGVtZW50OiBmdW5jdGlvbiAoZG9tTm9kZSkge1xuICAgICAgICBkb21Ob2RlLnBhcmVudEVsZW1lbnQucmVtb3ZlQ2hpbGQoZG9tTm9kZSk7XG4gICAgfSxcbiAgICB4UGF0aDogeFBhdGgsXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBPZmZlckVuZ2luZSB0b2tlblxuICAgICAqL1xuICAgIGdldFRva2VuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9LFxuICAgIHByZWxvYWRUb2tlbjogcHJlbG9hZFRva2VuLFxuICAgIGFkZERvbVJlYWR5TGlzdGVuZXI6IGZ1bmN0aW9uKGVudmlyb25tZW50KSB7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBsb2dnZXIuaW5mbygnRE9NIGlzIHJlYWR5Jyk7XG4gICAgICAgICAgICBpZighdG9rZW4gJiYgIWlzUHJlbG9hZGluZ1Rva2VuKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ0RPTSByZWFkeSwgbG9hZGluZyB0b2tlbicpO1xuICAgICAgICAgICAgICAgIHByZWxvYWRUb2tlbihlbnZpcm9ubWVudCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvL1dlIGRvbid0IGhhdmUgdG8gY2hlY2sgaWYgdGhlcmUncyBmdW5jdGlvbnMgd2FpdGluZywgY2F1c2UgdGhlIHRva2VuIGlzIG9ubHkganVzdCBiZWluZyBwcmVsb2FkZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWNXYWl0UmVhZHlGdW5jdGlvbnMoKTtcbiAgICAgICAgfSk7XG4gICAgfSxcbiAgICB3aGVuUmVhZHk6IHdoZW5SZWFkeVxufTsiLCIvKipcbiAqIENyZWF0ZWQgYnkgTmlla0tydXNlIG9uIDExLzEyLzE1LlxuICogVXRpbGl0eSBtb2R1bGUgY29udGFpbmluZyBoZWxwZXIgZnVuY3Rpb25zIGZvciBhamF4IHJlcXVlc3RzXG4gKlxuICovXG5mdW5jdGlvbiBhcHBlbmRRdWVyeVN0cmluZ09wdGlvbnMocmVxdWVzdFVybCwgcXVlcnlTdHJpbmdPcHRpb25zKSB7XG4gICAgcmVxdWVzdFVybCArPSBcIj9cIjtcbiAgICBmb3IgKHZhciBwcm9wIGluIHF1ZXJ5U3RyaW5nT3B0aW9ucykge1xuICAgICAgICBpZiAocXVlcnlTdHJpbmdPcHRpb25zLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICByZXF1ZXN0VXJsICs9IHByb3AgKyBcIj1cIiArIHF1ZXJ5U3RyaW5nT3B0aW9uc1twcm9wXSArIFwiJlwiO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy9SZW1vdmUgdGhlIGxhc3QgJiBmcm9tIHRoZSBzdHJpbmdcbiAgICByZXF1ZXN0VXJsID0gcmVxdWVzdFVybC5zdWJzdHIoMCwgcmVxdWVzdFVybC5sZW5ndGggLSAxKTtcbiAgICByZXR1cm4gcmVxdWVzdFVybDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgLyoqXG4gICAgICogQGNhbGxiYWNrIGFqYXhTdWNjZXNzQ2FsbGJhY2sgLSBUaGUgY2FsbGJhY2sgdG8gaW52b2tlIHdoZW4gdGhlIEFqYXggY2FsbCBpcyBzdWNjZXNzZnVsXG4gICAgICogQHBhcmFtIHtPYmplY3R9IC0gVGhlIGRhdGEgcmVjZWl2ZWQgZnJvbSB0aGUgQWpheCBjYWxsXG4gICAgICovXG5cbiAgICAvKipcbiAgICAgKiBAY2FsbGJhY2sgYWpheEVycm9yQ2FsbGJhY2sgLSBUaGUgY2FsbGJhY2sgdG8gaW52b2tlIHdoZW4gdGhlIEFqYXggY2FsbCByZXR1cm5zIGFuIGVycm9yXG4gICAgICogQHBhcmFtIHtPYmplY3R9IC0gVGhlIGVycm9yIG9iamVjdFxuICAgICAqL1xuXG4gICAgLyoqXG4gICAgICogQHR5cGVkZWYge09iamVjdH0gQWpheE9wdGlvbnMgLSBUaGUgcmVxdWVzdCBvcHRpb25zXG4gICAgICogQHByb3BlcnR5IHtzdHJpbmd9IHVybCAtIFRoZSBVUkwgb2YgdGhlIGdldCByZXF1ZXN0XG4gICAgICogQHByb3BlcnR5IHtPYmplY3QuPHN0cmluZywgc3RyaW5nPn0gW3F1ZXJ5XSAtIFRoZSBvcHRpb25zIHRvIGFwcGVuZCB0byB0aGUgcXVlcnkgc3RyaW5nXG4gICAgICogQHByb3BlcnR5IHthamF4U3VjY2Vzc0NhbGxiYWNrfSBzdWNjZXNzIC0gVGhlIGNhbGxiYWNrIHRvIGludm9rZSB3aGVuIHRoZSBhamF4IGNhbGwgc3VjY2VlZHNcbiAgICAgKiBAcHJvcGVydHkge2FqYXhFcnJvckNhbGxiYWNrfSBlcnJvciAtIFRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgYWpheCBjYWxsIHJldHVybnMgYW4gZXJyb3JcbiAgICAgKi9cblxuICAgIC8qKlxuICAgICAqIERvIGEgR0VUIHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0FqYXhPcHRpb25zfSBvcHRpb25zIC0gVGhlIG9wdGlvbnNcbiAgICAgKi9cbiAgICBnZXQ6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cbiAgICAgICAgdmFyIHJlcXVlc3RVcmwgPSBhcHBlbmRRdWVyeVN0cmluZ09wdGlvbnMob3B0aW9ucy51cmwsIG9wdGlvbnMucXVlcnkpO1xuICAgICAgICByZXF1ZXN0Lm9wZW4oJ2dldCcsIHJlcXVlc3RVcmwpO1xuXG4gICAgICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgb3B0aW9ucy5zdWNjZXNzKEpTT04ucGFyc2UocmVxdWVzdC5yZXNwb25zZVRleHQpKTtcbiAgICAgICAgfTtcblxuICAgICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbiAocHJvZ3Jlc3NFdmVudCkge1xuICAgICAgICAgICAgb3B0aW9ucy5lcnJvcihwcm9ncmVzc0V2ZW50KTtcbiAgICAgICAgfTtcblxuICAgICAgICByZXF1ZXN0LnNlbmQoKTtcbiAgICB9XG59OyIsIi8qKlxuICogQ3JlYXRlZCBieSBOaWVrS3J1c2Ugb24gMTEvNC8xNS5cbiAqXG4gKiBNb2R1bGUgZm9yIGVhc2lseSByZWFkaW5nIC8gd3JpdGluZyB0byBicm93c2VycycgTG9jYWxTdG9yYWdlIGFjcm9zcyBkb21haW5zXG4gKlxuICogVGhpcyB3b3JrcyBpbiB0aGUgZm9sbG93aW5nIHdheTpcbiAqXG4gKiAxLiBBbiBpRnJhbWUgaXMgbG9hZGVkIG9uIHRoZSBjdXJyZW50IChwdWJsaXNoZXIncykgcGFnZS5cbiAqIDIuIFRoZSBjb250ZW50cyBvZiB0aGlzIGlGcmFtZSBhcmUgaG9zdGVkIG9uIHRoZSBzYW1lIHNlcnZlciBhcyB0aGUgb2ZmZXJXYWxsXG4gKiAzLiBUaGUgcGFnZSBvZiB0aGUgaUZyYW1lIGNhbiByZWNlaXZlIG1lc3NhZ2VzIHRocm91Z2ggdGhlIHBvc3RNZXNzYWdlIGFwaVxuICogNC4gV2hlbiB0aGUgaUZyYW1lIHJlY2VpdmVzIGEgbWVzc2FnZSBpdCB1bmRlcnN0YW5kcywgaXQgZ2V0cyB0aGUgcmVxdWlyZWQgZGF0YSBmcm9tIHRoZSBsb2NhbFN0b3JhZ2UgQVBJXG4gKiAgICBCZWNhdXNlIHRoZSBpRnJhbWUgaXMgaG9zdGVkIG9uIHRoZSBPZmZlcldhbGwgc2VydmVyLCB0aGUgbG9jYWxTdG9yYWdlIGNvbnRlbnRzIHdpbGwgYmUgdGhlIHNhbWVcbiAqIDUuIFRoZSBpRnJhbWUgc2VuZHMgYmFjayBhIG1lc3NhZ2UgY29udGFpbmluZyB0aGUgcmVxdWVzdGVkIGRldGFpbHNcbiAqIDYuIFRoZSBDcm9zc0RvbWFpblN0b3JhZ2UgbW9kdWxlICh0aGlzIG9uZSkgaW52b2tlcyB0aGUgY2FsbGJhY2sgc3BlY2lmaWVkIGluIHRoZSByZXF1ZXN0XG4gKi9cbnZhciBhcHBTZXR0aW5ncyA9IHJlcXVpcmUoJy4uL2FwcFNldHRpbmdzJyksXG4gICAgbG9nZ2VyID0gcmVxdWlyZSgnLi4vdXRpbC9sb2dnZXInKTtcblxudmFyIE1FU1NBR0VfTkFNRVNQQUNFID0gXCJ4ZG9tYWluLWxvY2Fsc3RvcmFnZS1tZXNzYWdlXCI7XG5cbmZ1bmN0aW9uIGxvZ0NhbGxJbml0Rmlyc3QoKSB7XG4gICAgbG9nZ2VyLnd0ZihcIkNyb3NzRG9tYWluU3RvcmFnZSBub3QgaW5pdGlhbGl6ZWQgeWV0LiBDYWxsIC5pbml0KCkgZmlyc3QuXCIpO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgQ3Jvc3NEb21haW5TdG9yYWdlIG9iamVjdFxuICogQGNvbnN0cnVjdG9yXG4gKi9cbnZhciBYRG9tYWluTG9jYWxTdG9yYWdlID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuaXNSZWFkeSA9IGZhbHNlO1xuICAgIHRoaXMuX3JlcXVlc3RJRCA9IC0xO1xuICAgIHRoaXMuX2lmcmFtZSA9IG51bGw7XG4gICAgdGhpcy5faW5pdENhbGxiYWNrID0gbnVsbDtcbiAgICB0aGlzLl9yZXF1ZXN0cyA9IHt9O1xuXG4gICAgdGhpcy5fb3B0aW9ucyA9IHtcbiAgICAgICAgaWZyYW1lSUQ6IFwicG0tbGliLWlmcmFtZVwiXG4gICAgfTtcbn07XG5cbi8qKlxuICogRnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiBhIG1lc3NhZ2UgaXMgcmVjZWl2ZWQgZnJvbSB0aGUgaUZyYW1lXG4gKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgZGV0YWlscyBvZiB0aGUgcmVjZWl2ZWQgbWVzc2FnZVxuICogQHByaXZhdGVcbiAqL1xuWERvbWFpbkxvY2FsU3RvcmFnZS5wcm90b3R5cGUuX21lc3NhZ2VSZWNlaXZlZCA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgIHZhciBkYXRhO1xuICAgIHRyeSB7XG4gICAgICAgIGRhdGEgPSBKU09OLnBhcnNlKGV2ZW50LmRhdGEpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy9Qcm9iYWJseSByZWNlaXZlZCBhIG1lc3NhZ2UgdGhhdCBkaWRuJ3QgYmVsb25nIHRvIHVzLCBkbyBub3RoaW5nLlxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGRhdGEgJiYgZGF0YS5uYW1lc3BhY2UgPT09IE1FU1NBR0VfTkFNRVNQQUNFKSB7XG4gICAgICAgIC8vVGhlIG1lc3NhZ2UgYmVsb25ncyB0byB1c1xuICAgICAgICBpZiAoZGF0YS5pZCA9PT0gXCJpZnJhbWUtcmVhZHlcIikge1xuICAgICAgICAgICAgLy9DYWxsIHRoZSBpbml0IGNhbGxiYWNrXG4gICAgICAgICAgICB0aGlzLmlzUmVhZHkgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5faW5pdENhbGxiYWNrKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzUmVzcG9uc2UoZGF0YSk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vKipcbiAqIFByb2Nlc3MgYSByZXNwb25zZSBmcm9tIHRoZSBpRnJhbWUgYnkgaW52b2tpbmcgdGhlIGNvcnJlY3QgY2FsbGJhY2tcbiAqIEBwYXJhbSB7e319IG1lc3NhZ2VEYXRhIC0gdGhlIGRhdGEgcmVjZWl2ZWQgZnJvbSB0aGUgaUZyYW1lIG1lc3NhZ2VcbiAqIEBwcml2YXRlXG4gKi9cblhEb21haW5Mb2NhbFN0b3JhZ2UucHJvdG90eXBlLl9wcm9jZXNzUmVzcG9uc2UgPSBmdW5jdGlvbiAobWVzc2FnZURhdGEpIHtcbiAgICBpZiAodGhpcy5fcmVxdWVzdHNbbWVzc2FnZURhdGEuaWRdKSB7IC8vQ2hlY2sgaWYgd2UgZGlkIGluIGZhY3QgZXhwZWN0IHRoaXMgbWVzc2FnZSBmaXJzdFxuICAgICAgICB0aGlzLl9yZXF1ZXN0c1ttZXNzYWdlRGF0YS5pZF0obWVzc2FnZURhdGEpO1xuICAgICAgICBkZWxldGUgdGhpcy5fcmVxdWVzdHNbbWVzc2FnZURhdGEuaWRdO1xuICAgIH1cbn07XG5cbi8qKlxuICogQnVpbGRzIGEgbWVzc2FnZSBhbmQgc2VuZHMgaXQgdG8gdGhlIGxvYWRlZCBpRnJhbWVcbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSB0aGUgYWN0aW9uIHRvIGludm9rZVxuICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIHRoZSBrZXkgb2YgdGhlIGxvY2FsU3RvcmFnZSBpdGVtXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGxvY2FsU3RvcmFnZSBpdGVtXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIHRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgb3BlcmF0aW9uIGlzIGZpbmlzaGVkXG4gKiBAcHJpdmF0ZVxuICovXG5YRG9tYWluTG9jYWxTdG9yYWdlLnByb3RvdHlwZS5fY3JlYXRlTWVzc2FnZSA9IGZ1bmN0aW9uIChhY3Rpb24sIGtleSwgdmFsdWUsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fcmVxdWVzdElEKys7XG4gICAgdGhpcy5fcmVxdWVzdHNbdGhpcy5fcmVxdWVzdElEXSA9IGNhbGxiYWNrO1xuXG4gICAgdmFyIGRhdGEgPSB7XG4gICAgICAgIG5hbWVzcGFjZTogTUVTU0FHRV9OQU1FU1BBQ0UsXG4gICAgICAgIGlkOiB0aGlzLl9yZXF1ZXN0SUQsXG4gICAgICAgIGFjdGlvbjogYWN0aW9uLFxuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgfTtcblxuICAgIHRoaXMuX2lmcmFtZS5jb250ZW50V2luZG93LnBvc3RNZXNzYWdlKEpTT04uc3RyaW5naWZ5KGRhdGEpLCAnKicpO1xufTtcblxuLyoqXG4gKiBJbml0aWFsaXplIENyb3NzRG9tYWluTG9jYWxTdG9yYWdlIGJ5IGxvYWRpbmcgdGhlIGlGcmFtZVxuICogQHBhcmFtIGxvYWRlZENhbGxiYWNrIHRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgaUZyYW1lIGlzIHJlYWR5XG4gKi9cblhEb21haW5Mb2NhbFN0b3JhZ2UucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbiAobG9hZGVkQ2FsbGJhY2spIHtcbiAgICBpZiAodGhpcy5pc1JlYWR5KSB7XG4gICAgICAgIC8vV2UgYXJlIGFscmVhZHkgaW5pdGlhbGl6ZWQgYW5kIGFyZSByZWFkeSB0byByZWNlaXZlIG1lc3NhZ2VzLiBKdXN0IGRpcmVjdGx5IGludm9rZSB0aGUgY2FsbGJhY2tcbiAgICAgICAgbG9hZGVkQ2FsbGJhY2soKTtcbiAgICB9XG5cbiAgICB0aGlzLl9pbml0Q2FsbGJhY2sgPSBsb2FkZWRDYWxsYmFjaztcbiAgICBpZiAod2luZG93LmFkZEV2ZW50TGlzdGVuZXIpIHtcbiAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0aGlzLl9tZXNzYWdlUmVjZWl2ZWQuYmluZCh0aGlzKSwgZmFsc2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHdpbmRvdy5hdHRhY2hFdmVudCgnb25NZXNzYWdlJywgdGhpcy5fbWVzc2FnZVJlY2VpdmVkKTtcbiAgICB9XG5cbiAgICB0aGlzLmlzUmVhZHkgPSB0cnVlO1xuICAgIHZhciB0ZW1wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0ZW1wLmlubmVySFRNTCA9ICc8aWZyYW1lIGlkPVwiJyArIHRoaXMuX29wdGlvbnMuaWZyYW1lSUQgKyAnXCIgc3JjPVwiJyArIGFwcFNldHRpbmdzLnhEb21haW5TdG9yYWdlVVJMICsgJ1wiIHN0eWxlPVwiZGlzcGxheTogbm9uZTtcIj48L2lmcmFtZT4nO1xuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZCh0ZW1wKTtcblxuICAgIHRoaXMuX2lmcmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHRoaXMuX29wdGlvbnMuaWZyYW1lSUQpO1xufTtcblxuLyoqXG4gKiBTZXQgYW4gaXRlbSBpbiB0aGUgbG9jYWwgc3RvcmFnZSBob3N0ZWQgb24gYW5vdGhlciBkb21haW5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBrZXkgdGhlIGtleSBvZiB0aGUgaXRlbVxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gdmFsdWUgdGhlIHZhbHVlIG9mIHRoZSBpdGVtXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIHRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgb3BlcmF0aW9uIGlzIGZpbmlzaGVkXG4gKi9cblhEb21haW5Mb2NhbFN0b3JhZ2UucHJvdG90eXBlLnNldEl0ZW0gPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuaXNSZWFkeSkge1xuICAgICAgICBsb2dDYWxsSW5pdEZpcnN0KCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLl9jcmVhdGVNZXNzYWdlKFwic2V0SXRlbVwiLCBrZXksIHZhbHVlLCBjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIEdldHMgYW4gaXRlbSBmcm9tIHRoZSBsb2NhbFN0b3JhZ2UgaG9zdGVkIG9uIGFub3RoZXIgZG9tYWluXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gdGhlIGtleSBvZiB0aGUgaXRlbSB0byBnZXRcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IGNhbGxiYWNrIC0gdGhlIGNhbGxiYWNrIHRvIGludm9rZSB3aGVuIHRoZSBvcGVyYXRpb24gaXMgZmluaXNoZWRcbiAqL1xuWERvbWFpbkxvY2FsU3RvcmFnZS5wcm90b3R5cGUuZ2V0SXRlbSA9IGZ1bmN0aW9uIChrZXksIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmlzUmVhZHkpIHtcbiAgICAgICAgbG9nQ2FsbEluaXRGaXJzdCgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fY3JlYXRlTWVzc2FnZShcImdldEl0ZW1cIiwga2V5LCBudWxsLCBjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIGxvY2FsU3RvcmFnZSBhcGkgaXMgYXZhaWxhYmxlXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBCb29sZWFuIGluZGljYXRpbmcgd2hldGhlciBsb2NhbFN0b3JhZ2UgY2FuIGJlIHVzZWRcbiAqL1xuWERvbWFpbkxvY2FsU3RvcmFnZS5wcm90b3R5cGUuaXNBdmFpbGFibGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgdmFyIHN0b3JhZ2UgPSB3aW5kb3cubG9jYWxTdG9yYWdlO1xuXG4gICAgICAgIHZhciB0ZXN0ID0gJ19fc3RvcmFnZV9sb2NhbF90ZXN0X18nO1xuICAgICAgICBzdG9yYWdlLnNldEl0ZW0odGVzdCwgdGVzdCk7XG4gICAgICAgIHN0b3JhZ2UucmVtb3ZlSXRlbSh0ZXN0KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufTtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBYRG9tYWluTG9jYWxTdG9yYWdlKCk7IC8vQSBuZXcgaW5zdGFuY2UuXG5cbiIsIi8qKlxuICogQ3JlYXRlZCBieSBOaWVrS3J1c2Ugb24gMTAvMTYvMTUuXG4gKiBDb250YWlucyBhcHAgd2lkZSBlbnVtZXJhdGlvbnNcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgLyoqXG4gICAgICogVGhlIGVudW0gZm9yIHRoZSBsb2dMZXZlbFxuICAgICAqIEByZWFkb25seVxuICAgICAqIEBlbnVtIHtudW1iZXJ9XG4gICAgICovXG4gICAgbG9nTGV2ZWw6IHtcbiAgICAgICAgb2ZmOiAwLFxuICAgICAgICBkZWJ1ZzogMSxcbiAgICAgICAgd2FybjogMixcbiAgICAgICAgZXJyb3I6IDNcbiAgICB9LFxuICAgIC8qKlxuICAgICAqIFRoZSBlbnVtIGZvciB0aGUgbG9nVHlwZVxuICAgICAqIEByZWFkb25seVxuICAgICAqIEBlbnVtIHtzdHJpbmd9XG4gICAgICovXG4gICAgbG9nVHlwZToge1xuICAgICAgICBpbmZvOiBcIklORk9cIixcbiAgICAgICAgd2FybmluZzogXCJXQVJOSU5HXCIsXG4gICAgICAgIGVycm9yOiBcIkVSUk9SXCIsXG4gICAgICAgIHd0ZjogXCJGQVRBTFwiXG4gICAgfVxufTsiLCIvKipcbiAqIENyZWF0ZWQgYnkgTmlla0tydXNlIG9uIDEwLzE0LzE1LlxuICogSGVscGVyIG1vZHVsZSBmb3IgbG9nZ2luZyBwdXJwb3Nlc1xuICogQG1vZHVsZSB1dGlsL2xvZ2dlclxuICovXG52YXIgYXBwU2V0dGluZ3MgPSByZXF1aXJlKCcuLi9hcHBTZXR0aW5ncycpLFxuICAgIGVudW1lcmF0aW9ucyA9IHJlcXVpcmUoJy4uL3V0aWwvZW51bWVyYXRpb25zJyk7XG5cbmZ1bmN0aW9uIGluaXQoKSB7XG4gICAgLy9DaGVjayBpZiB0aGUgbG9nZ2VyIGV4aXN0c1xuICAgIGlmICghd2luZG93W2FwcFNldHRpbmdzLmxvZ2dlclZhcl0pIHtcbiAgICAgICAgdmFyIExvZ2dlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMubG9ncyA9IFtdO1xuICAgICAgICB9O1xuXG4gICAgICAgIExvZ2dlci5wcm90b3R5cGUuanNvbiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLmxvZ3MpO1xuICAgICAgICB9O1xuXG4gICAgICAgIExvZ2dlci5wcm90b3R5cGUucHJpbnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc3RyaW5nID0gXCJcIjtcblxuICAgICAgICAgICAgdmFyIGNvbnNvbGVSZWYgPSBjb25zb2xlO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxvZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgbG9nID0gdGhpcy5sb2dzW2ldO1xuXG4gICAgICAgICAgICAgICAgY29uc29sZVJlZi5sb2codG9GcmllbmRseVN0cmluZyhsb2cpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHN0cmluZztcbiAgICAgICAgfTtcblxuICAgICAgICB3aW5kb3dbYXBwU2V0dGluZ3MubG9nZ2VyVmFyXSA9IG5ldyBMb2dnZXIoKTtcbiAgICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgZnJpZW5kbHkgc3RyaW5nIG91dCBvZiBhIGxvZyBlbnRyeVxuICogQHBhcmFtIGxvZ0VudHJ5IC0gVGhlIExvZ0VudHJ5IHRvIGNyZWF0ZSBhIGZyaWVuZGx5IHN0cmluZyBmb3JcbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gdGhlIGZyaWVuZGx5IHN0cmluZyBvZiB0aGUgTG9nRW50cnlcbiAqL1xuZnVuY3Rpb24gdG9GcmllbmRseVN0cmluZyhsb2dFbnRyeSkge1xuICAgIHJldHVybiBcIltQTV9OYXRpdmVfQWRzIFwiICsgbG9nRW50cnkudHlwZSArIFwiXSBcIiArIGxvZ0VudHJ5LnRpbWUgKyBcIiAtIFwiICsgbG9nRW50cnkudGV4dDtcbn1cblxuLyoqXG4gKiBQdXNoIGEgbG9nRW50cnkgdG8gdGhlIGFycmF5IG9mIGxvZ3MgYW5kIG91dHB1dCBpdCB0byB0aGUgY29uc29sZVxuICogQHBhcmFtIGxvZ0VudHJ5IFRoZSBsb2dFbnRyeSB0byBwcm9jZXNzXG4gKi9cbmZ1bmN0aW9uIHB1c2hMb2dFbnRyeShsb2dFbnRyeSkge1xuICAgIHZhciBsb2dnZXIgPSB3aW5kb3dbYXBwU2V0dGluZ3MubG9nZ2VyVmFyXTtcbiAgICBpZiAobG9nZ2VyKSB7XG4gICAgICAgIGxvZ2dlci5sb2dzLnB1c2gobG9nRW50cnkpO1xuXG4gICAgICAgIGlmICh3aW5kb3cuY29uc29sZSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLmVycm9yID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIGNvbnNvbGUud2FybiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgc3dpdGNoIChsb2dFbnRyeS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgZW51bWVyYXRpb25zLmxvZ1R5cGUud3RmOlxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcih0b0ZyaWVuZGx5U3RyaW5nKGxvZ0VudHJ5KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBlbnVtZXJhdGlvbnMubG9nVHlwZS5lcnJvcjpcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhcHBTZXR0aW5ncy5sb2dMZXZlbCA8PSBlbnVtZXJhdGlvbnMubG9nTGV2ZWwuZXJyb3IgJiYgYXBwU2V0dGluZ3MubG9nTGV2ZWwgPiBlbnVtZXJhdGlvbnMubG9nTGV2ZWwub2ZmKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcih0b0ZyaWVuZGx5U3RyaW5nKGxvZ0VudHJ5KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBlbnVtZXJhdGlvbnMubG9nVHlwZS53YXJuaW5nOlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFwcFNldHRpbmdzLmxvZ0xldmVsIDw9IGVudW1lcmF0aW9ucy5sb2dMZXZlbC53YXJuICYmIGFwcFNldHRpbmdzLmxvZ0xldmVsID4gZW51bWVyYXRpb25zLmxvZ0xldmVsLm9mZikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2Fybih0b0ZyaWVuZGx5U3RyaW5nKGxvZ0VudHJ5KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhcHBTZXR0aW5ncy5sb2dMZXZlbCA8PSBlbnVtZXJhdGlvbnMubG9nTGV2ZWwuZGVidWcgJiYgYXBwU2V0dGluZ3MubG9nTGV2ZWwgPiBlbnVtZXJhdGlvbnMubG9nTGV2ZWwub2ZmKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2codG9GcmllbmRseVN0cmluZyhsb2dFbnRyeSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyh0b0ZyaWVuZGx5U3RyaW5nKGxvZ0VudHJ5KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogR2V0IHRoZSBjdXJyZW50IHRpbWUgYXMgYSBzdHJpbmdcbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gdGhlIGN1cnJlbnQgdGltZSBpbiBhIGhoOm1tOnNzIHN0cmluZ1xuICovXG5mdW5jdGlvbiBnZXRDdXJyZW50VGltZVN0cmluZygpIHtcbiAgICB2YXIgdG9kYXkgPSBuZXcgRGF0ZSgpO1xuICAgIHZhciBoaCA9IHRvZGF5LmdldEhvdXJzKCk7XG4gICAgdmFyIG1tID0gdG9kYXkuZ2V0TWludXRlcygpOyAvL0phbnVhcnkgaXMgMFxuICAgIHZhciBzcyA9IHRvZGF5LmdldFNlY29uZHMoKTtcbiAgICB2YXIgbXMgPSB0b2RheS5nZXRNaWxsaXNlY29uZHMoKTtcblxuICAgIGlmIChoaCA8IDEwKSB7XG4gICAgICAgIGhoID0gJzAnICsgaGg7XG4gICAgfVxuXG4gICAgaWYgKG1tIDwgMTApIHtcbiAgICAgICAgbW0gPSAnMCcgKyBtbTtcbiAgICB9XG5cbiAgICBpZiAoc3MgPCAxMCkge1xuICAgICAgICBzcyA9ICcwJyArIHNzO1xuICAgIH1cblxuICAgIGlmIChtcyA8IDEwKSB7XG4gICAgICAgIG1zID0gJzAnICsgbXM7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhoICsgXCI6XCIgKyBtbSArIFwiOlwiICsgc3MgKyBcIjpcIiArIG1zO1xufVxuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IExvZ0VudHJ5IC0gQSBsb2dnaW5nIGVudHJ5IG9iamVjdFxuICogQHBhcmFtIHtzdHJpbmd9IHRpbWUgLSBUaGUgdGltZSBvZiB0aGUgbG9nIGFzIGEgc3RyaW5nXG4gKiBAcGFyYW0ge3RleHR9IHRleHQgLSBUaGUgdGV4dCBvZiB0aGUgbG9nXG4gKi9cblxuLyoqXG4gKiBDcmVhdGUgYSBuZXcgTG9nRW50cnkgb2JqZWN0XG4gKiBAcGFyYW0ge3N0cmluZ30gbG9nVHlwZSAtIHRoZSB0eXBlIG9mIGxvZ1xuICogQHBhcmFtIHtzdHJpbmd9IGxvZ1RleHQgLSBUaGUgdGV4dCBvZiB0aGUgbG9nXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUxvZ0VudHJ5KGxvZ1R5cGUsIGxvZ1RleHQpIHtcbiAgICB2YXIgbG9nZ2VyID0gd2luZG93W2FwcFNldHRpbmdzLmxvZ2dlclZhcl07XG4gICAgaWYoIWxvZ2dlcikge1xuICAgICAgICBpbml0KCk7IC8vQWx3YXlzIGluaXRpYWxpemUgb24gb3VyIGZpcnN0IGxvZyBlbnRyeVxuICAgIH1cblxuICAgIHZhciBsb2cgPSB7XG4gICAgICAgIHR5cGU6IGxvZ1R5cGUsXG4gICAgICAgIHRpbWU6IGdldEN1cnJlbnRUaW1lU3RyaW5nKCksXG4gICAgICAgIHRleHQ6IGxvZ1RleHRcbiAgICB9O1xuXG4gICAgcHVzaExvZ0VudHJ5KGxvZyk7XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBpbmZvIGxvZ1xuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBsb2dUZXh0IC0gdGhlIHRleHQgdGhlIGxvZyBzaG91bGQgY29udGFpblxuICAgICAqL1xuICAgIGluZm86IGZ1bmN0aW9uIChsb2dUZXh0KSB7XG4gICAgICAgIGNyZWF0ZUxvZ0VudHJ5KGVudW1lcmF0aW9ucy5sb2dUeXBlLmluZm8sIGxvZ1RleHQpO1xuICAgIH0sXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyB3YXJuaW5nIGxvZ1xuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBsb2dUZXh0IC0gdGhlIHRleHQgdGhlIGxvZyBzaG91bGQgY29udGFpblxuICAgICAqL1xuICAgIHdhcm46IGZ1bmN0aW9uIChsb2dUZXh0KSB7XG4gICAgICAgIGNyZWF0ZUxvZ0VudHJ5KGVudW1lcmF0aW9ucy5sb2dUeXBlLndhcm5pbmcsIGxvZ1RleHQpO1xuICAgIH0sXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBlcnJvciBsb2dcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gbG9nVGV4dCAtIHRoZSB0ZXh0IHRoZSBsb2cgc2hvdWxkIGNvbnRhaW5cbiAgICAgKi9cbiAgICBlcnJvcjogZnVuY3Rpb24gKGxvZ1RleHQpIHtcbiAgICAgICAgY3JlYXRlTG9nRW50cnkoZW51bWVyYXRpb25zLmxvZ1R5cGUuZXJyb3IsIGxvZ1RleHQpO1xuICAgIH0sXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBXVEYgKFdoYXQgYSB0ZXJyaWJsZSBmYWlsdXJlKSBsb2dcbiAgICAgKiBUaGVzZSBzaG91bGQgbmV2ZXIgb2NjdXIgaW4gdGhlIGFwcGxpY2F0aW9uXG4gICAgICogV2lsbCBhbHdheXMgYmUgb3V0cHV0dGVkIGV2ZW4gaWYgdGhlIGxvZ0xldmVsIGlzIDBcbiAgICAgKiBAcGFyYW0gbG9nVGV4dFxuICAgICAqL1xuICAgIHd0ZjogZnVuY3Rpb24gKGxvZ1RleHQpIHtcbiAgICAgICAgY3JlYXRlTG9nRW50cnkoZW51bWVyYXRpb25zLmxvZ1R5cGUud3RmLCBsb2dUZXh0KTtcbiAgICB9XG59O1xuIiwidmFyIGNyb3NzRG9tYWluU3RvcmFnZSA9IHJlcXVpcmUoJy4vY3Jvc3NEb21haW5TdG9yYWdlJyk7XG52YXIgbG9nZ2VyID0gcmVxdWlyZSgnLi9sb2dnZXInKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG52YXIgYXBwU2V0dGluZ3MgPSByZXF1aXJlKCcuLi9hcHBTZXR0aW5ncycpO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHRva2VuIGZvciB0aGUgdXNlciB2aXNpdGluZyB0aGUgcGFnZVxuICogQHBhcmFtIGNhbGxiYWNrIC0gVGhlIGNhbGxiYWNrIHRoYXQgaXMgZXhlY3V0ZWQgd2hlbiB0aGUgdG9rZW4gaXMgcmVzb2x2ZWRcbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVRva2VuKGNhbGxiYWNrKSB7XG4gICAgdmFyIGNyb3NzRG9tYWluU3RvcmFnZUF2YWlsYWJsZSA9IGNyb3NzRG9tYWluU3RvcmFnZS5pc0F2YWlsYWJsZSgpO1xuICAgIGxvZ2dlci5pbmZvKCdSZXNvbHZpbmcgdG9rZW4gZnJvbSBPZmZlckVuZ2luZScpO1xuXG4gICAgaWYgKGNyb3NzRG9tYWluU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICBpbml0WERvbWFpblN0b3JhZ2UoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY3Jvc3NEb21haW5TdG9yYWdlLmdldEl0ZW0oYXBwU2V0dGluZ3MudG9rZW5Db29raWVLZXksIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEudmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ1JldHJpZXZlZCBleGlzdGluZyB0b2tlbjogJyArIGRhdGEudmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhkYXRhLnZhbHVlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZXRDcm9zc0RvbWFpblRva2VuKGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgbm8gY3Jvc3MgZG9tYWluIHN0b3JhZ2UsIHdlIGp1c3QgZ2VuZXJhdGUgYSByYW5kb20gdG9rZW4uXG4gICAgICAgIC8vIEluIHJlYWxpdHksIGNyb3NzIGRvbWFpbiBzdG9yYWdlIHdpbGwgYmUgYXZhaWxhYmxlIG9uIHByZXR0eSBtdWNoIGFsbCBkZXZpY2VzXG4gICAgICAgIC8vIEJlY2F1c2UgdGhleSBhbGwgc3VwcG9ydCBsb2NhbFN0b3JhZ2Ugbm93XG4gICAgICAgIHZhciB0b2tlbiA9IHV0aWxzLmdlbmVyYXRlVG9rZW4oKTtcbiAgICAgICAgY2FsbGJhY2sodG9rZW4pO1xuICAgIH1cbn1cblxuLyoqXG4gKiBAcGFyYW0ge3hEb21haW5TZXRUb2tlbkNhbGxiYWNrfSBjYWxsYmFjayAtIFRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgdG9rZW4gaXMgc2V0XG4gKi9cbmZ1bmN0aW9uIHNldENyb3NzRG9tYWluVG9rZW4oY2FsbGJhY2spIHtcbiAgICB2YXIgdG9rZW4gPSB1dGlscy5nZW5lcmF0ZVRva2VuKCk7XG4gICAgY3Jvc3NEb21haW5TdG9yYWdlLnNldEl0ZW0oYXBwU2V0dGluZ3MudG9rZW5Db29raWVLZXksIHRva2VuLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICBsb2dnZXIuaW5mbygnUmV0cmlldmVkIG5ldyB0b2tlbjogJyArIHRva2VuKTtcbiAgICAgICAgY2FsbGJhY2sodG9rZW4pO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIEluaXRpYWxpemUgdGhlIGNyb3NzIGRvbWFpbiBzdG9yYWdlIG1vZHVsZVxuICogQGNhbGxiYWNrIHhEb21haW5TdG9yYWdlUmVhZHlDYWxsYmFjayAtIFRoZSBjYWxsYmFjayB0aGF0IGlzIGludm9rZWQgd2hlbiB0aGUgeERvbWFpblN0b3JhZ2UgaXMgcmVhZHlcbiAqIEBwYXJhbSB7eERvbWFpblN0b3JhZ2VSZWFkeUNhbGxiYWNrfSBjYWxsYmFjayAtIFRoZSBjYWxsYmFjayB0byBpbnZva2Ugd2hlbiB0aGUgbW9kdWxlIGlzIHJlYWR5XG4gKi9cbmZ1bmN0aW9uIGluaXRYRG9tYWluU3RvcmFnZShjYWxsYmFjaykge1xuICAgIGlmIChjcm9zc0RvbWFpblN0b3JhZ2UuaXNSZWFkeSkge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNyb3NzRG9tYWluU3RvcmFnZS5pbml0KGNhbGxiYWNrKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcmVzb2x2ZVRva2VuOyIsIi8qKlxuICogQ3JlYXRlZCBieSBOaWVrS3J1c2Ugb24gMTAvNS8xNS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBjb250YWlucyBVdGlsaXR5IGZ1bmN0aW9ucyB0aGF0IGNhbiBiZSB1c2VkIHRocm91Z2hvdXQgdGhlIHByb2plY3QuXG4gKi9cblxuLyoqXG4gKiBPYmplY3QgY29udGFpbmluZyB1dGlsaXR5IGZ1bmN0aW9uc1xuICovXG52YXIgdXRpbHMgPSB7fTtcblxuLyoqXG4gKiBSZXBsYWNlcyBtYWNyb3MgaW4gYSBzdHJpbmcgd2l0aCBhY3R1YWwgdmFsdWVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyVG9Gb3JtYXQgLSBUaGUgc3RyaW5nIHRvIGZvcm1hdFxuICogQHJldHVybnMge3N0cmluZ30gdGhlIGZvcm1hdHRlZCBzdHJpbmdcbiAqL1xudXRpbHMuZm9ybWF0U3RyaW5nID0gZnVuY3Rpb24gKHN0clRvRm9ybWF0KSB7XG4gICAgdmFyIHMgPSBzdHJUb0Zvcm1hdDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgICAgdmFyIHJlZyA9IG5ldyBSZWdFeHAoXCJcXFxce1wiICsgaSArIFwiXFxcXH1cIiwgXCJnbVwiKTtcbiAgICAgICAgcyA9IHMucmVwbGFjZShyZWcsIGFyZ3VtZW50c1tpICsgMV0pO1xuICAgIH1cblxuICAgIHJldHVybiBzO1xufTtcblxuLyoqXG4gKiBDb252ZXJ0cyBhIHN0cmluZyB0byBhIHN0cmluZyBhcnJheSBpZiB0aGUgcGFzc2VkIHBhcmFtZXRlciBpcyBhIHN0cmluZy5cbiAqIElmIHRoZSBwYXNzZWQgcGFyYW1ldGVyIGlzIGFscmVhZHkgYSBzdHJpbmcgYXJyYXksIHRoZSBmdW5jdGlvbiB3aWxsIHJldHVybiBpdC5cbiAqIEBwYXJhbSB7c3RyaW5nfHN0cmluZ1tdfSBzdHJpbmdPckFycmF5IC0gVGhlIHN0cmluZyB0byBjb252ZXJ0IHRvIGFuIGFycmF5XG4gKiBAcmV0dXJucyB7QXJyYXkuPHN0cmluZz59IC0gVGhlIHN0cmluZyBhcnJheVxuICovXG51dGlscy5zdHJpbmdUb0FycmF5ID0gZnVuY3Rpb24gKHN0cmluZ09yQXJyYXkpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShzdHJpbmdPckFycmF5KSlcbiAgICAgICAgcmV0dXJuIHN0cmluZ09yQXJyYXk7XG5cbiAgICBpZiAodHlwZW9mIHN0cmluZ09yQXJyYXkgPT09ICdzdHJpbmcnIHx8IHN0cmluZ09yQXJyYXkgaW5zdGFuY2VvZiBTdHJpbmcpIHtcbiAgICAgICAgLy9GaXggaW50byBhcnJheVxuICAgICAgICBzdHJpbmdPckFycmF5ID0gW3N0cmluZ09yQXJyYXldO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IHN0cmluZ09yQXJyYXkudG9TdHJpbmcoKSArIFwiIGlzIG5vdCBhIHZhbGlkIHN0cmluZyBvciBzdHJpbmcgYXJyYXlcIjtcbiAgICB9XG5cbiAgICByZXR1cm4gc3RyaW5nT3JBcnJheTtcbn07XG5cbi8qKlxuICogR2VuZXJhdGUgYSByYW5kb20gdG9rZW4gZm9yIHRoZSBvZmZlcndhbGxcbiAqIFRPRE86IG1pZ2h0IG5lZWQgc29tZSBpbXByb3ZlbWVudFxuICogQHJldHVybnMge3N0cmluZ30gLSBBIHVuaXF1ZSB1c2VyIHRva2VuXG4gKi9cbnV0aWxzLmdlbmVyYXRlVG9rZW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHByZWZpeCA9IFwib2ZmZXJlbmdpbmVfXCI7XG4gICAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gICAgdmFyIHJhbmRvbSA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbiAgICByZXR1cm4gcHJlZml4ICsgbm93ICsgcmFuZG9tO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB1dGlscztcbiJdfQ==
