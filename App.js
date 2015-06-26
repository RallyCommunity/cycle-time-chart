var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    items : [
        {xtype:'container',itemId:'settings_box'},
    ],

    config: {
        defaultSettings: {
            type : "Story",
            field : "ScheduleState",
            states : "In-Progress,Completed",
            completedState : "Accepted",
            intervalNumber : "4",
            intervalType : "week",
            granularity : "day"
        }
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },


    launch: function() {
        if (this.isExternal()){
            this.showSettings(this.config);
        } else {
            this.onSettingsUpdate(this.getSettings());
        }
    },

    _launch: function() {

        var that = this;
        app = this;
        app.totalWorkItems = 0;

        this._workspaceConfig = this.getContext().getWorkspace().WorkspaceConfiguration;
    
        this.type = this.getSetting("type") === "Story" ? "HierarchicalRequirement" : this.getSetting("type");
        this.field = this.getSetting("field");
        this.states = this.getSetting("states").split(",");
        this.completedState = this.getSetting("completedState");
        this.lookbackPeriods = this.getSetting("intervalNumber");
        this.lookbackPeriod = this.getSetting("intervalType");
        this.granularity = this.getSetting("granularity");

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
                        deferred.resolve(snapshots);
                    }
                });
                return deferred.getPromise();
        });

        Deft.Promise.all(promises).then( {
            scope:that,
            success : function(intervalCompletedSnapshots) {

                that.completedSnapshots = _.flatten(intervalCompletedSnapshots);
                console.log("Completed Items",that.completedSnapshots);


                app.totalWorkItems = _.reduce(intervalCompletedSnapshots,function(memo,intSnaps) {
                    return memo + intSnaps.length;
                },0)

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

            // app.totalWorkItems = promises.length;

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

    showMask: function(msg) {
        if ( this.getEl() ) { 
            this.getEl().unmask();
            this.getEl().mask(msg);
        }
    },
    hideMask: function() {
        this.getEl().unmask();
    },

    getSnapshots : function(workItem) {

        // console.log("workItem",workItem);

        var that = this;
        // var query = that._getProjectScopedQuery(
        //     Ext.merge({
        //         // '_ProjectHierarchy': { "$in" : [Number(this.getContext().getProject().ObjectID)] },
        //         'ObjectID' : workItem.get("ObjectID")
        //     }, that.progressPredicate()));
        var query = 
            Ext.merge({
                // '_ProjectHierarchy': { "$in" : [Number(this.getContext().getProject().ObjectID)] },
                'ObjectID' : workItem.get("ObjectID")
            }, that.progressPredicate());


        console.log("query",JSON.stringify(query));

        var deferred = new Deft.Deferred();

        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                refresh: function(store) {
                    app.totalWorkItems = app.totalWorkItems - 1;
                    that.showMask("Loading snapshots for " + app.totalWorkItems + " work items.");

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
        // p[this.field] = {
        //     '$gte': (this.beginState === "No Entry") ? null : this.beginState,
        //     '$lt': this.endState
        // }
        p[this.field] = { "$in" : this.states }
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
                "$or" : [
                    {"_ValidTo": "9999-01-01T00:00:00.000Z"},
                    {"_ValidTo" : { "$lt" : interval.end }}    
                ],
                // "_ValidTo" : { "$lt" : interval.end },
                "_TypeHierarchy":{"$in":[type]}
        };

        // add dynamic elements to find
        find[field] = endState;
        find[("_PreviousValues." + field)] = { "$ne" : endState };
        find[("_PreviousValues." + field)] = { "$exists" : true };

        var fields = ["_TypeHierarchy","ObjectID","FormattedID","_ValidFrom","_PreviousValues."+field,field,"Name"];
        var hydrate = [ "_PreviousValues."+field, field, "_TypeHierarchy"];

        var config = {
            find : find,
            fetch : fields,
            hydrate : hydrate,
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: function(store, data, success) {
                    deferred.resolve(data);
                }
            }
        };

        console.log("query",JSON.stringify(config));

        Ext.create( 'Rally.data.lookback.SnapshotStore', config );

        return deferred.getPromise();
    },

    calcCyleTimeForState : function( stateSnapshots ) {

        var that = this;
        // var snapshots = _.pluck(stateSnapshots.snapshots,function(s) { return s.data;});
        var snapshots = stateSnapshots;
        var granularity = that.granularity;
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

        var createSeries = function(interval, arrWorkItemSnapshots) {
            return {
                name : interval.name,
                data : _.map( _.filter(arrWorkItemSnapshots,function(arr){return arr.length>0;}),
                 function( workItemSnapshots ) {
                    var objId = _.first(workItemSnapshots).ObjectID;
                    var completedItem = _.find(that.completedSnapshots,function(s) {
                        return s.get("ObjectID")===objId;
                    });
                    var y = _.first(that.calcCyleTimeForState(workItemSnapshots));

                    return {
                        y : _.isUndefined(y) ? null : y.ticks,
                        x : moment.utc(completedItem.get("_ValidFrom")).toDate(),
                        workItem : { 
                            FormattedID : completedItem.get("FormattedID"),
                            Name : completedItem.get("Name")
                        }
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

        that.unmask();

        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }

        that.chart = Ext.create('Rally.technicalservices.cycleTimeChart', {
            itemId: 'rally-chart',
            chartData: chartData,
        });

        that.add(that.chart);

    },

    // settings code and overrides 
        //showSettings:  Override
    showSettings: function(options) {
        this._appSettings = Ext.create('Rally.app.AppSettings', Ext.apply({
            fields: this.getSettingsFields(),
            settings: this.getSettings(),
            defaultSettings: this.getDefaultSettings(),
            context: this.getContext(),
            settingsScope: this.settingsScope,
            autoScroll: true
        }, options));

        this._appSettings.on('cancel', this._hideSettings, this);
        this._appSettings.on('save', this._onSettingsSaved, this);
        if (this.isExternal()){
            if (this.down('#settings_box').getComponent(this._appSettings.id)===undefined){
                this.down('#settings_box').add(this._appSettings);
            }
        } else {
            this.hide();
            this.up().add(this._appSettings);
        }
        return this._appSettings;
    },
    _onSettingsSaved: function(settings){
        Ext.apply(this.settings, settings);
        this._hideSettings();
        this.onSettingsUpdate(settings);
    },
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        console.log('onSettingsUpdate',settings);
        Ext.apply(this, settings);
        this._launch(settings);
    },

    // type : "HierarchicalRequirement",
    // field : "ScheduleState",
    // states : "In-Progress,Completed",
    // completedState : "Accepted",
    // intervalNumber : "4",
    // intervalType : "week",
    // granularity : "day"

    getSettingsFields: function() {
        var me = this;
        return [ 
            {
                name: 'type',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Type',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Rally data type for which cycle time is being calculated<br/><span style="color:#999999;">eg.<i>Story</i> <i>Task</i> <i>Defect</i> <i>PortfolioItem/Feature</i></span>'
            },
            {
                name: 'field',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'State Field',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The Rally field used for state<br/><span style="color:#999999;">eg. <i>ScheduleState State</i></span>'
            },
            {
                name: 'states',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'States',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'A comma delimited list of the states to calculated cycle time for<br/><span style="color:#999999;">eg. <i>In-Progress,Completed</i></span>'
            },
            {
                name: 'completedState',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Completed State',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The state that represents "completed" <br/><span style="color:#999999;">eg. <i>Accepted</i></span>'
            },
            {
                name: 'intervalNumber',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Intervals',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The number of intervals to report on<br/><span style="color:#999999;">eg. <i>4</i></span>'
            },
            {
                name: 'intervalType',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Interval Type',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The interval type<br/><span style="color:#999999;">eg. <i>week</i><i>day</i><i>month</i></span>'
            },
            {
                name: 'granularity',
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Granularity',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Report cycle time in hours or days<br/><span style="color:#999999;">eg. <i>day</i><i>hour</i></span>'
            }
        ];
    }

});
