var async = require("async"),
    util = require("odm-util"),
    oriento = require("oriento");

var Session = require("./session"),
    defaults = require("./defaults");
    
var DISCONNECTED = -1,
    // CONNECTING = 0,
    CONNECTED = 1;


var initForSession = function(connect, callback) {
    var Store = connect.Store || connect.session.Store;

    function OrientoStore(options) {
        try {
            Store.call(this, defaults.ensureGenericStoreOptions(options));
    
            this._options = defaults.ensureOrientoStoreOptions(options);
            this._state = DISCONNECTED;
            this._ensureConnection();
        } catch(err) {
            if (callback) {
                return callback(err);
            } else {
                throw err;
            }
        }
        
        this._ensureDBClass(callback);
        
        /* ugly Oriento issue of connection timeout */
        var interval = this._options.pingInterval;
        /* init DB ping to now */
        this._db.ping = new Date();
        setInterval(pingDb, interval, this._db, interval);
    }

    OrientoStore.prototype.get = function(sid, callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                Session.findById(db, sid, function(err, dbInstance) {
                    done(err, fromDBInstance(dbInstance));
                });
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype.set = function(sid, session, callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                Session.findById(db, sid, done);
            },
            function(dbInstance, done) {
                if (!dbInstance) {
                    dbInstance = new Session({ id: sid });
                }
                dbInstance = mergeToDBInstance(dbInstance, session);
                dbInstance["#touched"] = new Date();
                dbInstance.save(done);
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype.touch = function(sid, session, callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                Session.findById(db, sid, done);
            },
            function(dbInstance, done) {
                if (!dbInstance) {
                    dbInstance = new Session({ id: sid });
                    /* set data for new DB instances only */
                    dbInstance = mergeToDBInstance(dbInstance, session);
                }
                dbInstance["#touched"] = new Date();
                dbInstance.save(done);
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype.destroy = function(sid, callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                Session.delete(db, { id: sid }, done);
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype.length = function(callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                db.select("count(*)").from(Session.name).scalar().then(function(total) {
                    done(null, total);
                }).catch(done);
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype.clear = function(callback) {
        var self = this, db = self._db;
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                Session.delete(db, {}, done);
            }
        ], callback || defaults.returnOneCallback);
    };

    OrientoStore.prototype._ensureConnection = function(callback) {
        var self = this;
        if (!callback) {
            callback = defaults.returnOneCallback;
        }
        if (self._state == CONNECTED && self._db) {
            return callback(null, self._db);
        }
        var err;
        try {
            self._db = oriento(self._options.server).use(self._options.db);
            self._state = CONNECTED;
        } catch(ex) {
            err = ex;
            self._state = DISCONNECTED;
        }
        return callback(err, self._db);
    };

    OrientoStore.prototype._ensureDBClass = function(callback) {
        var self = this, db = self._db,
            idIndexName = Session.name + ".id";
        return async.waterfall([
            function(done) {
                done(self._state < CONNECTED ? new Error("disconnected from the DB") : null);
            },
            function(done) {
                db.class.get(Session.name).then(function(DBSessionClass) {
                    done(null, DBSessionClass);
                }).catch(function() {
                    db.class.create(Session.name, "V").then(function(DBSessionClass) {
                        console.log("created " + Session.name + " cluster");
                        done(null, DBSessionClass);
                    }).catch(done);
                });
            },
            function(DBSessionClass, done) {
                DBSessionClass.property.get("id").then(function() {
                    done(null, DBSessionClass);
                }).catch(function() {
                    DBSessionClass.property.create({ name: 'id', type: 'String' }).then(function() {
                        console.log("created " + idIndexName + " property");
                        done(null, DBSessionClass);
                    }).catch(done);
                });
            },
            function(DBSessionClass, done) {
                db.index.get(idIndexName).then(function(){
                    done(null, DBSessionClass);
                }).catch(function() {
                    db.index.create({ name: idIndexName, type: 'unique'}).then(function() {
                        console.log("created " + idIndexName + " index");
                        done(null);
                    }).catch(done);
                });
            }
        ], callback || defaults.returnOneCallback);
    };

    util.clazz.inherit(OrientoStore, Store);
    return OrientoStore;
};


module.exports = initForSession;


/**
 * @deprecated Oriento drops the binary connection, 
 * so keep this one until the issue is resolved
 */
var pingDb = function(db, interval) {
    var now = new Date();
    // do not ping the same DB multiple times
    if (now - db.ping >= interval) {
        db.ping = now;
        db.query("SELECT FROM OUser").then(function() {
        }).catch(function(err) {
            console.error(err);
        });
    }
};

var mergeToDBInstance = function(dbInstance, session) {
    return util.object.merge(dbInstance, session, true);
};

var fromDBInstance = function(dbInstance) {
    var res = {};
    if (dbInstance) {
        for (var key in dbInstance) {
            var startsWith = key.substr(0, 1);
            if (dbInstance.hasOwnProperty(key) && startsWith != "#" && startsWith != "@" && key != "id") {
                res[key] = dbInstance[key];
            }
        }
    }
    return res;
};
