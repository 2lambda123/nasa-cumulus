"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[1021],{15680:(e,n,t)=>{t.d(n,{xA:()=>p,yg:()=>m});var r=t(96540);function o(e,n,t){return n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t,e}function a(e,n){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);n&&(r=r.filter((function(n){return Object.getOwnPropertyDescriptor(e,n).enumerable}))),t.push.apply(t,r)}return t}function l(e){for(var n=1;n<arguments.length;n++){var t=null!=arguments[n]?arguments[n]:{};n%2?a(Object(t),!0).forEach((function(n){o(e,n,t[n])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):a(Object(t)).forEach((function(n){Object.defineProperty(e,n,Object.getOwnPropertyDescriptor(t,n))}))}return e}function i(e,n){if(null==e)return{};var t,r,o=function(e,n){if(null==e)return{};var t,r,o={},a=Object.keys(e);for(r=0;r<a.length;r++)t=a[r],n.indexOf(t)>=0||(o[t]=e[t]);return o}(e,n);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(r=0;r<a.length;r++)t=a[r],n.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(o[t]=e[t])}return o}var s=r.createContext({}),u=function(e){var n=r.useContext(s),t=n;return e&&(t="function"==typeof e?e(n):l(l({},n),e)),t},p=function(e){var n=u(e.components);return r.createElement(s.Provider,{value:n},e.children)},c="mdxType",d={inlineCode:"code",wrapper:function(e){var n=e.children;return r.createElement(r.Fragment,{},n)}},g=r.forwardRef((function(e,n){var t=e.components,o=e.mdxType,a=e.originalType,s=e.parentName,p=i(e,["components","mdxType","originalType","parentName"]),c=u(t),g=o,m=c["".concat(s,".").concat(g)]||c[g]||d[g]||a;return t?r.createElement(m,l(l({ref:n},p),{},{components:t})):r.createElement(m,l({ref:n},p))}));function m(e,n){var t=arguments,o=n&&n.mdxType;if("string"==typeof e||o){var a=t.length,l=new Array(a);l[0]=g;var i={};for(var s in n)hasOwnProperty.call(n,s)&&(i[s]=n[s]);i.originalType=e,i[c]="string"==typeof e?e:o,l[1]=i;for(var u=2;u<a;u++)l[u]=t[u];return r.createElement.apply(null,l)}return r.createElement.apply(null,t)}g.displayName="MDXCreateElement"},66267:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>p,contentTitle:()=>s,default:()=>m,frontMatter:()=>i,metadata:()=>u,toc:()=>c});var r=t(58168),o=t(98587),a=(t(96540),t(15680)),l=["components"],i={id:"reports",title:"Reconciliation Reports",hide_title:!1},s=void 0,u={unversionedId:"features/reports",id:"version-v18.3.2/features/reports",title:"Reconciliation Reports",description:"Report Types",source:"@site/versioned_docs/version-v18.3.2/features/reports.md",sourceDirName:"features",slug:"/features/reports",permalink:"/cumulus/docs/v18.3.2/features/reports",draft:!1,tags:[],version:"v18.3.2",lastUpdatedBy:"Paul Pilone",lastUpdatedAt:1722348174,formattedLastUpdatedAt:"Jul 30, 2024",frontMatter:{id:"reports",title:"Reconciliation Reports",hide_title:!1},sidebar:"docs",previous:{title:"Execution Payload Retention",permalink:"/cumulus/docs/v18.3.2/features/execution_payload_retention"},next:{title:"Ancillary Metadata Export",permalink:"/cumulus/docs/v18.3.2/features/ancillary_metadata"}},p={},c=[{value:"Report Types",id:"report-types",level:2},{value:"Inventory Reports",id:"inventory-reports",level:3},{value:"Granule Not Found Reports",id:"granule-not-found-reports",level:3},{value:"Viewing Reports on the Cumulus Dashboard",id:"viewing-reports-on-the-cumulus-dashboard",level:2},{value:"API",id:"api",level:2},{value:"Creating a Report via API",id:"creating-a-report-via-api",level:3},{value:"Retrieving a Report via API",id:"retrieving-a-report-via-api",level:3}],d={toc:c},g="wrapper";function m(e){var n=e.components,i=(0,o.A)(e,l);return(0,a.yg)(g,(0,r.A)({},d,i,{components:n,mdxType:"MDXLayout"}),(0,a.yg)("h2",{id:"report-types"},"Report Types"),(0,a.yg)("h3",{id:"inventory-reports"},"Inventory Reports"),(0,a.yg)("p",null,"Inventory reports provide a detailed report of collections, granules and files in Cumulus and CMR.\nThis report shows the following data:"),(0,a.yg)("ul",null,(0,a.yg)("li",{parentName:"ul"},"Granule files in Cumulus, those that are in S3",(0,a.yg)("sup",{parentName:"li",id:"fnref-note"},(0,a.yg)("a",{parentName:"sup",href:"#fn-note",className:"footnote-ref"},"note"))," but missing in the internal data store and those in the internal data store but not S3"),(0,a.yg)("li",{parentName:"ul"},"All Collections in Cumulus and CMR, highlighting any collections only in Cumulus or only in CMR"),(0,a.yg)("li",{parentName:"ul"},"All Granules in Cumulus and CMR belonging to collections found in both, highlighting any granules only in Cumulus or only in CMR"),(0,a.yg)("li",{parentName:"ul"},"All granule files in Cumulus and CMR belonging to granules found in both, highlighting any files only in Cumulus or only in CMR")),(0,a.yg)("h3",{id:"granule-not-found-reports"},"Granule Not Found Reports"),(0,a.yg)("ul",null,(0,a.yg)("li",{parentName:"ul"},"Granule Not Found reports provide a fixed view on missing granules, comparing them across S3, Cumulus, and CMR."),(0,a.yg)("li",{parentName:"ul"},"For an individual granule, it will display whether it is okay (green), missing some data (yellow),\nor missing all data (red) for each of S3, Cumulus, and CMR")),(0,a.yg)("h2",{id:"viewing-reports-on-the-cumulus-dashboard"},"Viewing Reports on the Cumulus Dashboard"),(0,a.yg)("p",null,"The Cumulus Dashboard offers an interface to create, manage and view these inventory reports."),(0,a.yg)("p",null,"The Reconciliation Reports Overview page shows a full list of existing reports and the option to create a new report.\n",(0,a.yg)("img",{alt:"Screenshot of the Dashboard Reconciliation Reports Overview page",src:t(21548).A,width:"2822",height:"1396"})),(0,a.yg)("p",null,"Viewing an inventory report will show a detailed list of collections, granules and files.\n",(0,a.yg)("img",{alt:"Screenshot of an Inventory Report page",src:t(88505).A,width:"2814",height:"1454"})),(0,a.yg)("p",null,"Viewing a granule not found report will show a list of granules missing data\n",(0,a.yg)("img",{alt:"Screenshot of a Granule Not Found Report page",src:t(15294).A,width:"2860",height:"1394"})),(0,a.yg)("h2",{id:"api"},"API"),(0,a.yg)("p",null,"The API also allows users to create and view reports. For more extensive API documentation, see the ",(0,a.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#list-reconciliation-reports"},"Cumulus API docs"),"."),(0,a.yg)("h3",{id:"creating-a-report-via-api"},"Creating a Report via API"),(0,a.yg)("p",null,"Create a new inventory report with the following:"),(0,a.yg)("pre",null,(0,a.yg)("code",{parentName:"pre",className:"language-bash"},"curl --request POST https://example.com/reconciliationReports --header 'Authorization: Bearer ReplaceWithToken'\n")),(0,a.yg)("p",null,"Example response:"),(0,a.yg)("pre",null,(0,a.yg)("code",{parentName:"pre",className:"language-json"},'{\n    "message": "Report is being generated",\n    "status": 202\n}\n')),(0,a.yg)("h3",{id:"retrieving-a-report-via-api"},"Retrieving a Report via API"),(0,a.yg)("p",null,"Once a report has been generated, you can retrieve the full report."),(0,a.yg)("pre",null,(0,a.yg)("code",{parentName:"pre",className:"language-bash"},"curl https://example.com/reconciliationReports/inventoryReport-20190305T153430508 --header 'Authorization: Bearer ReplaceWithTheToken'\n")),(0,a.yg)("p",null,"Example response:"),(0,a.yg)("pre",null,(0,a.yg)("code",{parentName:"pre",className:"language-json"},'{\n    "reportStartTime": "2019-03-05T15:34:30.508Z",\n    "reportEndTime": "2019-03-05T15:34:37.243Z",\n    "status": "SUCCESS",\n    "error": null,\n    "filesInCumulus": {\n        "okCount": 40,\n        "onlyInS3": [\n            "s3://cumulus-test-sandbox-protected/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml",\n            "s3://cumulus-test-sandbox-private/BROWSE.MYD13Q1.A2017297.h19v10.006.2017313221201.hdf"\n        ],\n        "onlyInDb": [\n            {\n                "uri": "s3://cumulus-test-sandbox-protected/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",\n                "granuleId": "MOD09GQ.A2016358.h13v04.006.2016360104606"\n            }\n        ]\n    },\n    "collectionsInCumulusCmr": {\n        "okCount": 1,\n        "onlyInCumulus": [\n            "L2_HR_PIXC___000"\n        ],\n        "onlyInCmr": [\n            "MCD43A1___006",\n            "MOD14A1___006"\n        ]\n    },\n    "granulesInCumulusCmr": {\n        "okCount": 3,\n        "onlyInCumulus": [\n            {\n                "granuleId": "MOD09GQ.A3518809.ln_rVr.006.7962927138074",\n                "collectionId": "MOD09GQ___006"\n            },\n            {\n                "granuleId": "MOD09GQ.A8768252.HC4ddD.006.2077696236118",\n                "collectionId": "MOD09GQ___006"\n            }\n        ],\n        "onlyInCmr": [\n            {\n                "GranuleUR": "MOD09GQ.A0002421.oD4zvB.006.4281362831355",\n                "ShortName": "MOD09GQ",\n                "Version": "006"\n            }\n        ]\n    },\n    "filesInCumulusCmr": {\n        "okCount": 11,\n        "onlyInCumulus": [\n            {\n                "fileName": "MOD09GQ.A8722843.GTk5A3.006.4026909316904.jpeg",\n                "uri": "s3://cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A8722843.GTk5A3.006.4026909316904.jpeg",\n                "granuleId": "MOD09GQ.A8722843.GTk5A3.006.4026909316904"\n            }\n        ],\n        "onlyInCmr": [\n            {\n                "URL": "https://cumulus-test-sandbox-public.s3.amazonaws.com/MOD09GQ___006/MOD/MOD09GQ.A8722843.GTk5A3.006.4026909316904_ndvi.jpg",\n                "Type": "GET DATA",\n                "GranuleUR": "MOD09GQ.A8722843.GTk5A3.006.4026909316904"\n            }\n        ]\n    }\n}\n')),(0,a.yg)("div",{className:"footnotes"},(0,a.yg)("hr",{parentName:"div"}),(0,a.yg)("ol",{parentName:"div"},(0,a.yg)("li",{parentName:"ol",id:"fn-note"},"Reconciliation reports only search data buckets for objects during the\nreport generation.  The data buckets will include any buckets in your\nCumulus buckets configuration that have type ",(0,a.yg)("inlineCode",{parentName:"li"},"public"),", ",(0,a.yg)("inlineCode",{parentName:"li"},"protected")," or\n",(0,a.yg)("inlineCode",{parentName:"li"},"private"),".",(0,a.yg)("a",{parentName:"li",href:"#fnref-note",className:"footnote-backref"},"\u21a9")))))}m.isMDXComponent=!0},15294:(e,n,t)=>{t.d(n,{A:()=>r});const r=t.p+"assets/images/granule_not_found_report-5d1f6eb5573bd271c77216fc22cebae5.png"},88505:(e,n,t)=>{t.d(n,{A:()=>r});const r=t.p+"assets/images/inventory_report-9a35e828c44a54f690d8c8d8f3e5339c.png"},21548:(e,n,t)=>{t.d(n,{A:()=>r});const r=t.p+"assets/images/rec_reports_overview-a32c3ea908b4ebb881853e0a82a6eb1d.png"}}]);