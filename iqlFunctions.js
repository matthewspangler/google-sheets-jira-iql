// Fill out the following 3 variables. Base_url should be the REST API url for Insight. Something like this:
//      https://api.atlassian.com/jsm/insight/workspace/{workspace id}/v1/

const jira_user_email = "";
const jira_api_key = "";
const base_url = "";

const memoize = (fn) => {
  /**
   * Jira API has a rate limit for calls/requests. In order to avoid maxing it out, I am caching
   * functions with an expiration time. That way excessive function calls are pulled from the
   * cache instead of creating duplicate JIRA API requests. This technique is called memoization.
   */

    // The _cache var isn't remembered between script runs, so we have to store it in Google's Cache Service.
    let cache_service = CacheService.getDocumentCache();

    // Uncomment to clear previous cache:
    //cache_service.remove("_cache")

    let _limit = 1000,
        _time = 1000*60*60*24 // 1 hour in ms

    // Checks if _cache in cache_service
    var _cache = new Map(JSON.parse(cache_service.get("_cache")));
    if (_cache.size == 0) {
        _cache = new Map()
    }

    // Used to put _cache in Google's CacheService:
    function cacheServicePut(cache_to_put) {
      cache_service.put("_cache", JSON.stringify([..._cache.entries()]))
    }

    // Used to get _cache from Google's CacheService:
    function cacheServiceGet(cache_to_get) {
      return cache_service.get("_cache")
    }

    function memoized(...args) {
        const key = JSON.stringify(args)
        return get(key) || set(key, fn.apply(this, args))
    }

    //Set item limit of cache
    memoized.limit = function(limit) {
        if (typeof limit !== 'number')
            throw new TypeError()
        _limit = limit
        return this
    }

    //Set expire time of cache items in ms (refreshes all entries)
    memoized.expire = function(time) {
        if (typeof time !== 'number')
            throw new TypeError()
        _time = time
        return this
    }

    //Clear cache
    memoized.flush = function() {
        _cache.clear()
        return this
    }

    //Add item to cache (delete items if limit is exceeded or time is expired)
    function set(key, value) {
        const entries = _cache.entries(),
              date = Date.now()

        while(true) {
            let entry = entries.next()
            if (entry.value && (_cache.size > _limit || entry.value[1].expire + _time < date))
                remove(entry.value[0])
            else
                break
        }
        _cache.set(key, { value, expire: Date.now() })
        cacheServicePut(_cache)
        return value
    }

    //Returns item.value of given key (delete item if time is expired)
    function get(key) {
        const entry = _cache.get(key)
        if (entry) {
            if (entry.expire + _time > Date.now()) {
                Logger.log("Using memoized function.")
                return entry.value
            } else {
                remove(key)
            }
        }
        return undefined
    }

    //Delete item of given key
    function remove(key) {
        _cache.delete(key)
        cacheServicePut(_cache)
        return this
    }

    if (fn instanceof Function)
        return memoized
    throw new TypeError()
}

/**
 * insightRequest()
 * @param string path [the REST API path URL - make sure you use encodeURIComponent() for any query.]
 * @return a dict containing the API response passed to JSON.parse()
 */
function insightRequest(path) {
  var url = base_url + path;
  var options = { "method": "GET",
                  "muteHttpExceptions": true,
                  "headers": {"Authorization": "Basic " + Utilities.base64Encode(jira_user_email + ":" + jira_api_key),
                           "Content-Type": "application/json"}
                 };
  var response = UrlFetchApp.fetch(url, options);
  var json = response.getContentText();
  return JSON.parse(json);
};

/**
 * insightObjectsIql()
 * Does an IQL search on Insight objects.
 * @param string iql_query [The IQL search query.]
 * @return a list containing the IQL search responses.
 */
function insightObjectsIql(iql_query) {
  var encoded_query = encodeURIComponent(iql_query);
  var path = 'iql/objects' + '?iql=' + encoded_query;
  var response_dict = insightRequest(path);
  return response_dict;
};

/**
 * getObjectTypeIdFromName()
 * Finds the object type ID from an object type's name.
 * @param string name [The object type name.]
 * @param string object_schema_id [The object schema ID.]
 * @return a list containing the IQL search responses.
 */
function getObjectTypeIdFromName(name, object_schema_id) {
  var data = insightRequest("objectschema/" + object_schema_id + "/objecttypes");
  for (const object_type of data) {
    if ("name" in object_type) {
      if (name == object_type["name"]) {
        return object_type["id"];
      };
    };
  };
  return null;
};

/**
 * getObjectTypeAttributeId()
 * Gets the ID of an object type's attribute, by the name.
 * @param string name [The name of the object type's attribute.]
 * @param string object_name [The object type name.]
 */
function getObjectTypeAttributeId(name, object_name, object_schema_id) {
  var object_type_id = getObjectTypeIdFromName(object_name, object_schema_id);
  var data = insightRequest("objecttype/" + object_type_id + "/attributes");
  for (const item in data) {
    if (name == data[item]["name"]) {
      return data[item]["id"];
    };
  };
  return null;
};

/**
 * getLazyIQL
 * Does an IQL search and retrieves all values for a specified attribute.
 * @param string iql_search [The IQL search query.]
 * @param string attribute [The fields to return from the IQL search.]
 * @return the key's corresponding value as a string.
 */
function getLazyIQL(iql_search, attribute, object_name, object_schema_id) {
  var objectTypeAttributeId = getObjectTypeAttributeId(attribute, object_name, object_schema_id);
  Logger.log("Object Type Attribute ID: " + objectTypeAttributeId);
  var data = insightObjectsIql(iql_search);
  var object_entries = data['objectEntries'];
  //Logger.log(JSON.stringify(object_entries,null,2));
  var results = [];
  for (const object of object_entries) {
    for (const attribute of object["attributes"]) {
      if ("objectTypeAttributeId" in attribute) {
        if (objectTypeAttributeId == attribute["objectTypeAttributeId"]) {
          //Logger.log(JSON.stringify(attribute,null,2));
          results.push(attribute["objectAttributeValues"][0]["displayValue"]);
        };
      };
    };
  };
  return results;
};

/**
 * Frontend functions for use in Google Sheets:
 */

function _LAZYIQL(iql_search, attribute, object_name, object_schema_id) {
  return getLazyIQL(iql_search, attribute)[0];
};


function _LAZYIQL_LIST(iql_search, attribute, object_name, object_schema_id) {
  return getLazyIQL(iql_search, attribute).join(";");
};

/**
 * Used the memoized functions instead. They're cached and won't exceed the JIRA API rate limit!
 */
var MEMOIZED_IQL = memoize(_LAZYIQL);
var MEMOIZED_IQL_LIST = memoize(_LAZYIQL_LIST);

/**
 * LAZYIQL()
 * Returns only the first value of getLazyIQL()
 * @param string iql_search [The IQL search query.]
 * @param string attribute [The fields to return from the IQL search.]
 * @return the key's corresponding value as a string.
 */
function LAZYIQL(iql_search, attribute, object_name, object_schema_id) {
  return MEMOIZED_IQL(iql_search, attribute, object_name, object_schema_id);
}

/**
 * LAZYIQL()
 * Same as LAZYIQL() but returns all entries, not just the first.
 * @param string iql_search [The IQL search query.]
 * @param string attribute [The fields to return from the IQL search.]
 * @return the key's corresponding value as a string.
 */
function LAZYIQL_LIST(iql_search, attribute, object_name, object_schema_id) {
  return MEMOIZED_IQL_LIST(iql_search, attribute, object_name, object_schema_id);
}
