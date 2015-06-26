Ext.define('Rally.technicalservices.cycleTimeChart',{
    extend: 'Rally.ui.chart.Chart',
    alias: 'widget.progresschart',

    itemId: 'rally-chart',
    chartData: {},
    loadMask: false,
    chartColors : [],
    chartConfig: {
        // colors : ["#E0E0E0","#00a9e0","#fad200","#8dc63f"],
        chart: {
            type: 'scatter',
            zoomType: 'xy',
        },
        title: {
            text: 'Cycle Time'
        },
        xAxis: {
            type: 'datetime',
            // dateTimeLabelFormats: {
            //     day: '%e of %b'
            // }
            //tickInterval : 24 * 3600 * 1000,
            title: {
                enabled : true,
                text: 'Date'
            },
            startOnTick: true,
            endOnTick: true,
        },
        yAxis: [
            {
                title: {
                    text: 'Days'
                }
            }
        ],

        plotOptions: {
            scatter: {
                tooltip: {
                    xDateFormat: '%Y-%m-%d',
                    headerFormat: '<b>{series.name}</b><br>',
                    pointFormat: '{point.x}<br>{point.workItem.FormattedID}:{point.workItem.Name} ({point.y})'
                }

            }
        },
    },
    constructor: function (config) {
        this.callParent(arguments);
        if (config.title){
            this.chartConfig.title = config.title;
        }
    }
});