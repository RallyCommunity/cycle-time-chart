var app = null;

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    items : [
        {xtype:'container',itemId:'settings_box'}
    ],

    subTitleTemplate : 'Type: <b>{type}</b> States:<b>{states}</b> Completed:<b>{completed}</b> Interval:<b>{interval} {interval_type}s</b>',

    config: {
        defaultSettings: {
            type : "Story",
            field : "ScheduleState",
            states : "In-Progress,Completed",
            completedState : "Accepted",
            completedStateName : "Accepted",
            intervalNumber : "4",
            intervalType : "week",
            granularity : "day",
            percentiles : true,
            stddev : false,
            // featureProgressState : false
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
        console.log("TypeID:",app.getSetting("typeObjectID"));

        this._workspaceConfig = this.getContext().getWorkspace().WorkspaceConfiguration;
    
        this.type = this.getSetting("type") === "Story" ? "HierarchicalRequirement" : this.getSetting("type");
        this.typeObjectID = app.getSetting("typeObjectID");
        this.field = this.getSetting("field");
        this.states = this.getSetting("states").split(",");
        // this.completedState = this.getSetting("completedState").get("name");
        this.completedState = this.getSetting("completedStateName");
        this.lookbackPeriods = this.getSetting("intervalNumber");
        this.lookbackPeriod = this.getSetting("intervalType");
        this.granularity = this.getSetting("granularity") === "day" ? "day" : "hour";

        // return if no type selected.
        if (_.isNull(this.typeObjectID)) {
            this.add({html:"No type selected. Edit App Settings to select"});
            return;
        }

        var intervals = this.getDateIntervals(this.lookbackPeriod,this.lookbackPeriods);
        console.log("intervals", intervals);
        app.totalIntervals = intervals.length;
        that.showMask("Loading completed snapshots for " + app.totalIntervals + " intervals.");

        var promises = _.map(intervals,function(interval) {
            var deferred = Ext.create('Deft.Deferred');
                that._getCompletedSnapshots(
                    // that.type, 
                    that.typeObjectID,
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

                console.log("intervalCompletedSnapshots",intervalCompletedSnapshots);

                // var filtered = [];

                // _.each(intervalCompletedSnapshots,function(bucket,x) {

                //     var remaining = _.map(intervalCompletedSnapshots,function(iSnapshots,i) {
                //         return i > x ? iSnapshots : null;
                //     });

                //     remaining = _.flatten(_.compact(remaining));

                //     var f = _.filter(bucket,function(item) {
                //         return _.find(remaining,function(r) { return r.raw.ObjectID === item.raw.ObjectID;});
                //     });
                //     filtered.push(f);
                // });

                // console.log("filtered",filtered);

                that.completedSnapshots = _.flatten(intervalCompletedSnapshots);
                console.log("Completed Items",that.completedSnapshots);


                app.totalWorkItems = _.reduce(intervalCompletedSnapshots,function(memo,intSnaps) {
                    return memo + intSnaps.length;
                },0);

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

        var that = this;
        var query = 
            Ext.merge({
                'ObjectID' : workItem.get("ObjectID")
            }, that.progressPredicate());

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
                    // console.log(_.first(snapshots).FormattedID,snapshots.length);
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
        p[this.field] = { "$in" : this.states };
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
            '_ProjectHierarchy': { "$in" : [Number(this.getContext().getProject().ObjectID)] }
        }, query);
    },

    _getCompletedSnapshots : function(typeObjectID, field, endState, interval) {

        var that = this;

        var deferred = new Deft.Deferred();

        var find = {
                "_ProjectHierarchy" : { "$in" : [this.getContext().getProject().ObjectID] },
                "$and" :[
                    {"_ValidFrom" : { "$gte" : interval.start }},
                    {"_ValidFrom" : { "$lt" : interval.end }}
                ],
                // "_TypeHierarchy":{"$in":[type]}
                "_TypeHierarchy":{"$in":[typeObjectID]}
        };

        // "_PreviousValues.ActualEndDate" : null

        // add dynamic elements to find
        find[field] = endState;
        find[("_PreviousValues." + field)] = { "$ne" : endState };
        find[("_PreviousValues." + field)] = { "$exists" : true };

        var fields = ["_TypeHierarchy","ObjectID","FormattedID","_ValidFrom","_PreviousValues."+field,field,"Name"];
        var hydrate = [ "_PreviousValues."+field, field /**, "_TypeHierarchy"**/];

        var config = {
            find : find,
            fetch : fields,
            hydrate : hydrate,
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: function(store, data, success) {
                    app.totalIntervals = app.totalIntervals - 1;
                    that.showMask("Loading completed snapshots for " + app.totalIntervals + " intervals.");
                    deferred.resolve(data);
                }
            }
        };

        // console.log("query",JSON.stringify(config));

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
        
        var start = moment().subtract(1, 'years').toISOString();
        var end =   moment().toISOString();
        var tisc = null;
        if (_.isUndefined(window.parent._lumenize)) {
            tisc = new window._lumenize.TimeInStateCalculator(config);
        } else {
            tisc = new window.parent._lumenize.TimeInStateCalculator(config);
        }
        // tisc = new window.parent._lumenize.TimeInStateCalculator(config);
        tisc.addSnapshots(snapshots, start, end);
        var results = tisc.getResults();
        // console.log("results",snapshots,results);

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
                    };
                })
            };
        };


        var series = {
            series : _.map(intervals,function(interval,i) { 
                return createSeries(interval,results[i]);
            })  
        };

        // add y axis label
        series.granularity = that.granularity + "s";

        // add percentile plotlines (horizontal lines) if configured
        if (that.getSetting("percentiles") === "true" || that.getSetting("percentiles")===true) {
            series = that.addPercentiles(series);
        }

        if (that.getSetting("stddev") === "true" || that.getSetting("stddev")===true) {
            series = that.addStdDeviation(series);
        }
        
        var tpl = new Ext.XTemplate(that.subTitleTemplate);
        series.subtitle = {};
        series.subtitle.text = "";
        series.subtitle.text = tpl.apply( { 
            type : that.type , 
            states : that.states , 
            completed : that.completedState,
            interval : that.lookbackPeriods,
            interval_type : that.lookbackPeriod } );

        // this.type = this.getSetting("type") === "Story" ? "HierarchicalRequirement" : this.getSetting("type");
        // this.field = this.getSetting("field");
        // this.states = this.getSetting("states").split(",");
        // this.completedState = this.getSetting("completedState");

        return series;

    },

    createChart : function( chartData ) {

        var that = this;

        that.unmask();

        if (!_.isUndefined(that.chart)) {
            that.remove(that.chart);
        }

        that.chart = Ext.create('Rally.technicalservices.cycleTimeChart', {
            itemId: 'rally-chart',
            chartData: chartData
        });

        that.add(that.chart);

    },

    addPercentiles : function(series) {

        // calculate percentiles
        var data = _.flatten(_.map( series.series, function(s) { return s.data; }));
        var ys = _.map(data,function(d){return d.y;});
        var pValues = [0.5,0.75,0.99];
        var pcts = _.map(pValues,function(p) { 
            return ys.percentile(p);
        });
        series.plotLines = _.map(pcts,function(p,i){
            return {
                color: '#C8C8C8 ',
                width:2,
                zIndex:4,
                label:{text:''+(pValues[i]*100)+'% = '+p},
                dashStyle: 'dot', // Style of the plot line. Default to solid
                value: p // Value of where the line will appear
            };
        });

        return series;
    },

    addStdDeviation : function(series) {

        // calculate percentiles
        var data = _.flatten(_.map( series.series, function(s) { return s.data; }));
        var ys = _.map(data,function(d){return d.y;});
        var mean = ys.mean();
        var stdDev = ys.stdDev();

        series.plotBands = [{
            color: '#FFF5EE', // Color value : light organge
            from: (mean - stdDev) > 0 ? (mean-stdDev) : 0,
            to: mean + stdDev
        }];

        return series;
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
        console.log("Saving Settings",settings);
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

    /********************************************
    /* for drop-down filtering
    /*
    /********************************************/
    _filterOutExceptChoices: function(store) {
        store.filter([{
            filterFn:function(field){ 
                var attribute_definition = field.get('fieldDefinition').attributeDefinition;
                var attribute_type = null;
                if ( attribute_definition ) {
                    attribute_type = attribute_definition.AttributeType;
                }
                if (  attribute_type == "BOOLEAN" ) {
                    return true;
                }
                if ( attribute_type == "STRING" || attribute_type == "STATE" ) {
                    if ( field.get('fieldDefinition').attributeDefinition.Constrained ) {
                        return true;
                    }
                }
                if ( field.get('name') === 'State' ) { 
                    return true;
                }
                return false;
            } 
        }]);
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

        var intervalsStore = new Ext.data.ArrayStore({
            fields: ['interval'],
            data : [['day'],['week'],['month'],['year']]
        });  

        var granularityStore = new Ext.data.ArrayStore({
            fields: ['granularity'],
            data : [['day'],['hour']]
        });  

        return [ 

            {
                name: 'type',
                xtype:'rallycombobox',
                displayField: 'DisplayName',
                fieldLabel: 'Artifact Type',
                afterLabelTpl: 'Rally data type for which cycle time is being calculated<br/><span style="color:#999999;">eg.<i>Story</i> <i>Task</i> <i>Defect</i> <i>PortfolioItem/Feature</i></span>',

                autoExpand: true,
                storeConfig: {
                    model:'TypeDefinition',
                    filters: [
                      {property:'Restorable',value:true}
                    ]
                },
                labelStyle : "width:200px;",
                labelAlign: 'left',
                minWidth: 200,
                margin: "0 0 15 50",
                valueField:'TypePath',
                bubbleEvents: ['select','ready','typeSelectedEvent'],
                readyEvent: 'ready',
                   listeners: {
                    ready: function(field_box,records) {
                        if (this.getRecord()!==false)
                            this.fireEvent('typeSelectedEvent', this.getRecord(),this.modelType);
                    },
                    select: function(field_picker,records) {
                        console.log("firing type event",this.getRecord());
                        this.fireEvent('typeSelectedEvent', this.getRecord(),this.modelType);
                    }
                },
            },
            {
                name: 'typeObjectID',
                hidden : true,
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Intervals',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                handlesEvents: { 
                    typeSelectedEvent: function(type) {
                        console.log("received:",type)
                        this.setValue(type.get("ObjectID"));
                    }
                }
            },
            {
                name: 'field',
                xtype: 'rallyfieldcombobox',
                fieldLabel: 'Group By',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The Rally field used for state<br/><span style="color:#999999;">eg. <i>ScheduleState State</i></span>',

                labelAlign: 'left',
                minWidth: 200,
                // margin: 10,
                autoExpand: false,
                alwaysExpanded: false,
                handlesEvents: { 
                    select: function(type_picker) {
                        console.log("type_picker.getValue()",type_picker.getValue());
                        this.modelType = type_picker.getValue();
                        this.refreshWithNewModelType(type_picker.getValue());
                    },
                    ready: function(type_picker){
                        this.refreshWithNewModelType(type_picker.getValue());
                    }
                },
                listeners: {
                    ready: function(field_box,records) {
                        me._filterOutExceptChoices(field_box.getStore());
                        console.log("field combo ready:",this.getRecord());
                        if (this.getRecord()!==false)
                            this.fireEvent('myspecialevent1', this.getRecord(),this.modelType);
                    },
                    select: function(field_picker,records) {
                        console.log("firing event",field_picker,records);
                        this.fireEvent('myspecialevent1', _.first(records),this.modelType);
                    }
                },
                bubbleEvents: ['myspecialevent1'],
                readyEvent: 'ready'
            },
            {   
                name: 'possibleState',
                xtype: 'rallyfieldvaluecombobox',
                model : "UserStory",
                field : "ScheduleState",
                boxLabelAlign: 'after',
                fieldLabel: 'State',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Click on one or more states to add or remove in the list',
                handlesEvents: { 
                    myspecialevent1: function(field,model) {
                        this.setField(field.raw.fieldDefinition);
                    }
                },
                listeners : {
                    select : function(state_picker,records) {
                        console.log("state_picker",state_picker,"records",records);
                        this.fireEvent("state_selected",_.first(records).get("name"));
                    }
                },
                bubbleEvents : ['state_selected']
            },
            {
                name: 'states',
                width : 400,
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'States',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                // afterLabelTpl: 'A comma delimited list of the states to calculated cycle time for<br/><span style="color:#999999;">eg. <i>In-Progress,Completed</i></span>',
                handlesEvents: { 
                    state_selected: function(state) {
                        console.log("state_selected",this.getValue(),state);
                        var vals = _.filter(this.getValue().split(","),function(s) { return s.length > 0; });
                        console.log(vals);
                        var x = vals.indexOf(state);
                        if ( x == -1 )
                            vals.push(state);
                        else
                            vals.remove(x);
                        this.setValue(vals.join(","));
                    },
                    myspecialevent1: function(field,model) {
                        // this.setValue("");
                    }

                }
            },

            {
                name: 'completedState',
                xtype: 'rallyfieldvaluecombobox',
                model : "UserStory",
                field : "ScheduleState",
                boxLabelAlign: 'after',
                fieldLabel: 'Completed State',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The state that represents "completed" <br/><span style="color:#999999;">eg. <i>Accepted</i></span>',
                handlesEvents: { 
                    myspecialevent1: function(field,model) {
                        console.log("getValue1",this.getValue());
                        this.setField(field.raw.fieldDefinition);
                        console.log("getValue2",this.getValue());
                    }
                },
                listeners : {
                    select : function(picker,records) {
                        this.fireEvent("completed_state_selected",_.first(records).get("name"));
                    },
                    ready: function(picker) {
                        console.log("Completed State Ready:",this.getValue());
                        this.setValue(me.getSetting("completedStateName"));
                        console.log("value",me.getSetting("completedStateName"));
                    }
                },
                bubbleEvents : ['completed_state_selected']
            },
            {
                name: 'completedStateName',
                hidden : true,
                xtype: 'rallytextfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Intervals',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                handlesEvents: { 
                    completed_state_selected: function(completedStateName) {
                        this.setValue(completedStateName);
                    }
                }
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
            // {
            //     name: 'intervalType',
            //     xtype: 'rallytextfield',
            //     boxLabelAlign: 'after',
            //     fieldLabel: 'Interval Type',
            //     margin: '0 0 15 50',
            //     labelStyle : "width:200px;",
            //     afterLabelTpl: 'The interval type<br/><span style="color:#999999;">eg. <i>week </i><i>day </i><i>month</i></span>'
            // },
            {
                name: 'intervalType',
                xtype: 'combo',
                store : intervalsStore,
                valueField : 'interval',
                displayField : 'interval',
                queryMode : 'local',
                forceSelection : true,
                boxLabelAlign: 'after',
                fieldLabel: 'Interval Type',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'The interval type<br/><span style="color:#999999;">eg. <i>week </i><i>day </i><i>month</i></span>'
            },

            {
                name: 'granularity',
                xtype: 'combo',
                store : granularityStore,
                valueField : 'granularity',
                displayField : 'granularity',
                queryMode : 'local',
                forceSelection : true,
                boxLabelAlign: 'after',
                fieldLabel: 'Granularity',
                margin: '0 0 15 50',
                labelStyle : "width:200px;",
                afterLabelTpl: 'Report cycle time in hours or days<br/><span style="color:#999999;">eg. <i>day </i><i>hour</i></span>'
            },
            {
                name: 'percentiles',
                xtype: 'rallycheckboxfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Show Percentile Lines',
                margin: '0 0 15 50',
                boxLabel: 'Show Percentile Lines'
            },
            {
                name: 'stddev',
                xtype: 'rallycheckboxfield',
                boxLabelAlign: 'after',
                fieldLabel: 'Show +/- 1 Standard Deviation',
                margin: '0 0 15 50',
                boxLabel: '(Y-Axis Plotband)'
            }
            // ,
            //  {
            //     name: 'featureProgressState',
            //     xtype: 'rallycheckboxfield',
            //     boxLabelAlign: 'after',
            //     fieldLabel: 'Use Story progress for Features',
            //     margin: '0 0 15 50',
            //     boxLabel: 'Use Story progress for Features'
            // }

        ];
    }

});
