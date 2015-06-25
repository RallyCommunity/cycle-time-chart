Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {

        var that = this;

        this._workspaceConfig = this.getContext().getWorkspace().WorkspaceConfiguration;
    
        this.type = "HierarchicalRequirement",
        this.field = "ScheduleState",
        this.beginState    = "Defined";
        this.endState      = "Completed";
        this.completedState = "Accepted";
        this.lookbackPeriods = 6;
        this.lookbackPeriod = "month";

        var intervals = this.getDateIntervals(this.lookbackPeriod,this.lookbackPeriods);
        console.log("intervals", intervals);
        var promises = _.map(intervals,function(interval) {
            var deferred = Ext.create('Deft.Deferred');
                that._getCompletedSnapshots(
                    that.type, 
                    that.field, 
                    that.completedState,
                    interval
                ).then({
                    scope: that,
                    success: function(snapshots) {
                        that.completedSnapshots = snapshots;
                        deferred.resolve(snapshots);
                    }
                });
                return deferred.getPromise();
        });

        Deft.Promise.all(promises).then( {
            scope:that,
            success : function(intervalCompletedSnapshots) {
                // console.log("intervalCompletedSnapshots",intervalCompletedSnapshots);
                var cPromises = _.map(intervalCompletedSnapshots,function(intCompletedSnapshots,i) {
                    var deferred = Ext.create('Deft.Deferred');
                    that.getCycleTimeSnapshots(
                        intCompletedSnapshots
                    ).then({
                        scope : that,
                        success : function(snapshots) {
                            deferred.resolve(snapshots);
                        }
                    });
                    return deferred;
                });
                Deft.Promise.all(cPromises).then( {
                    scope : that,
                    success : function(all) {
                        console.log("all",all);
                        // that.createChart( intervals, that.prepareChartData(all) );
                        var chartData = that.prepareChartData(intervals,all);
                        // console.log(chartData);
                        that.createChart(chartData);
                    }
                });
            }
        });

    },

    getCycleTimeSnapshots : function(workItems) {

        // console.log("getCycleTimeSnapshots",workItems);

        var that = this;
        var deferred1 = new Deft.Deferred();

        if (workItems.length===0) {
            deferred1.resolve([]);
        } else {
            // workitems is an array of arrays of workitems
            var promises = _.map( workItems, function(workItem) {

                var deferred = Ext.create('Deft.Deferred');
                    that.getSnapshots(
                        workItem
                    ).then({
                        scope: that,
                        success: function(snapshots) {
                            deferred.resolve(snapshots);
                        }
                    });
                    return deferred.getPromise();
            });

            Deft.Promise.all(promises).then( {
                scope : that,
                success : function(cycleTimes) {
                    // console.log("cycleTimes",cycleTimes);
                    deferred1.resolve(cycleTimes);
                },
                failure : function(error) {
                    console.log("failure",error);
                }
            });
        }
        return deferred1.getPromise();
    },

    getWorkItemSnapshots : function(workItems) {

        var that = this;

        var deferred1 = new Deft.Deferred();

        var promises = _.map( workItems, function(workItem) {
            var deferred = Ext.create('Deft.Deferred');
                that.getSnapshots(
                    workItem
                ).then({    
                    scope: that,
                    success: function(snapshots) {
                        deferred.resolve(snapshots);
                    }
                });
            return deferred.getPromise();
        });

        Deft.Promise.all(promises).then( {
            scope : that,
            success : function(allWorkItemSnapshots) {
                // console.log("getWorkItemSnapshots",allWorkItemSnapshots);
                deferred1.resolve(allWorkItemSnapshots);
            }
        });
        return deferred1.getPromise();
    },

    getSnapshots : function(workItem) {

        // console.log("workItem",workItem);

        var that = this;
        var query = that._getProjectScopedQuery(
            Ext.merge({
                // '_ProjectHierarchy': { "$in" : [Number(this.getContext().getProject().ObjectID)] },
                'ObjectID' : workItem.get("ObjectID")
            }, that.progressPredicate()));

        // console.log("query",JSON.stringify(query));

        var deferred = new Deft.Deferred();

        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                refresh: function(store) {
                    //Extract the raw snapshot data...
                    var snapshots = [];
                    for (var i = 0, ii = store.getTotalCount(); i < ii; ++i) {
                        snapshots.push(store.getAt(i).data);
                    }
                    // console.log("snapshots:",snapshots.length);
                    deferred.resolve(snapshots);
                }
            },
            fetch: ['FormattedID','ObjectID', '_ValidTo', '_ValidFrom',that.field],
            hydrate : [that.field],
            find: query,
            sort: { "_ValidFrom": 1 }
        });
        

        return deferred.getPromise();
    },

    progressPredicate : function() {
        var p = {};
        p[this.field] = {
            '$gte': (this.beginState === "No Entry") ? null : this.beginState,
            '$lt': this.endState
        }
        return p;
    },

    getDateIntervals : function(period, periods) {
        var n = moment();
        var intervals = [];

        var start = moment().startOf(period);
        var end = moment().endOf(period);

        for( i = 0; i < periods; i++) {
            intervals.push({
                start : start.toISOString(),
                end : end.toISOString(),
                name : start.format("MM/DD/YYYY")
            });
            start = start.subtract(1,period);
            end = end.subtract(1,period);
        }
        return intervals.reverse();
    },

    _getProjectScopedQuery: function(query) {
        return Ext.merge({
            //'_ProjectHierarchy': Number((!_.isUndefined(__PROJECT_OID__) ? __PROJECT_OID__ : this.getContext().getProject().ObjectID) 
            '_ProjectHierarchy': { "$in" : [Number(this.getContext().getProject().ObjectID)] }
        }, query);
    },

    _getCompletedSnapshots : function(type, field, endState, interval) {

        var deferred = new Deft.Deferred();

        var find = {
                "_ProjectHierarchy" : { "$in" : [this.getContext().getProject().ObjectID] },
                "_ValidFrom" : { "$gte" : interval.start },
                "_ValidTo" : { "$lt" : interval.end },
                "_TypeHierarchy":{"$in":[type]}
        };

        // add dynamic elements to find
        find[field] = endState;
        find[("_PreviousValues." + field)] = { "$ne" : endState };
        find[("_PreviousValues." + field)] = { "$exists" : true };

        var fields = ["_TypeHierarchy","ObjectID","FormattedID","_ValidFrom","_PreviousValues."+field,field];
        var hydrate = [ "_PreviousValues."+field, field ];

        var config = {
            find : find,
            fetch : fields,
            hydrate : hydrate,
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: function(store, data, success) {
                    // console.log("success",success,data);
                    deferred.resolve(data);
                }
            }
        };

        Ext.create( 'Rally.data.lookback.SnapshotStore', config );

        return deferred.getPromise();
    },

    calcCyleTimeForState : function( stateSnapshots ) {

        var that = this;
        // var snapshots = _.pluck(stateSnapshots.snapshots,function(s) { return s.data;});
        var snapshots = stateSnapshots;
        // var granularity = 'day';
        var granularity = "day"; //app.getSetting("timeInHours") === false ? 'day' : 'hour';
        var tz = 'America/New_York';
        
        var config = { //  # default work days and holidays
            granularity: granularity,
            tz: tz,
            validFromField: '_ValidFrom',
            validToField: '_ValidTo',
            uniqueIDField: 'FormattedID',
            workDayStartOn: { hour: 13, minute: 0 }, // # 09:00 in Chicago is 15:00 in GMT
            workDayEndBefore: { hour: 22, minute: 0 } // # 11:00 in Chicago is 17:00 in GMT  # 
        };
        
        var start = moment().dayOfYear(0).toISOString();
        var end =   moment().toISOString();
        tisc = new window.parent._lumenize.TimeInStateCalculator(config);
        tisc.addSnapshots(snapshots, start, end);
        var results = tisc.getResults();
        return results;
    },

    prepareChartData : function ( intervals, results ) {
        var that = this;
        // var categories = _.map(intervals,function(interval){ return interval.name; });

        var createSeries = function(interval, arrWorkItemSnapshots) {
            return {
                name : interval.name,
                data : _.map( _.filter(arrWorkItemSnapshots,function(arr){return arr.length>0;}),
                 function( workItemSnapshots ) {
                    var y = _.first(that.calcCyleTimeForState(workItemSnapshots));
                    return {
                        y : _.isUndefined(y) ? null : y.ticks,
                        x : moment.utc(_.last(workItemSnapshots)._ValidFrom).toDate(),
                        workItem : _.first(workItemSnapshots)
                    }
                })
            };
        };

        return {
            series : _.map(intervals,function(interval,i) { 
                return createSeries(interval,results[i]);
            })  
        };
    },

    createChart : function( chartData ) {

        var that = this;

        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }

        that.chart = Ext.create('Rally.technicalservices.cycleTimeChart', {
            itemId: 'rally-chart',
            chartData: chartData,
        });

        that.add(that.chart);

    }

});
