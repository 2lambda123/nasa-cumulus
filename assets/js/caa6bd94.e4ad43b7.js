"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[36483],{3905:(e,t,o)=>{o.d(t,{Zo:()=>p,kt:()=>f});var r=o(67294);function n(e,t,o){return t in e?Object.defineProperty(e,t,{value:o,enumerable:!0,configurable:!0,writable:!0}):e[t]=o,e}function a(e,t){var o=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),o.push.apply(o,r)}return o}function l(e){for(var t=1;t<arguments.length;t++){var o=null!=arguments[t]?arguments[t]:{};t%2?a(Object(o),!0).forEach((function(t){n(e,t,o[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(o)):a(Object(o)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(o,t))}))}return e}function s(e,t){if(null==e)return{};var o,r,n=function(e,t){if(null==e)return{};var o,r,n={},a=Object.keys(e);for(r=0;r<a.length;r++)o=a[r],t.indexOf(o)>=0||(n[o]=e[o]);return n}(e,t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(r=0;r<a.length;r++)o=a[r],t.indexOf(o)>=0||Object.prototype.propertyIsEnumerable.call(e,o)&&(n[o]=e[o])}return n}var u=r.createContext({}),i=function(e){var t=r.useContext(u),o=t;return e&&(o="function"==typeof e?e(t):l(l({},t),e)),o},p=function(e){var t=i(e.components);return r.createElement(u.Provider,{value:t},e.children)},c="mdxType",d={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},m=r.forwardRef((function(e,t){var o=e.components,n=e.mdxType,a=e.originalType,u=e.parentName,p=s(e,["components","mdxType","originalType","parentName"]),c=i(o),m=n,f=c["".concat(u,".").concat(m)]||c[m]||d[m]||a;return o?r.createElement(f,l(l({ref:t},p),{},{components:o})):r.createElement(f,l({ref:t},p))}));function f(e,t){var o=arguments,n=t&&t.mdxType;if("string"==typeof e||n){var a=o.length,l=new Array(a);l[0]=m;var s={};for(var u in t)hasOwnProperty.call(t,u)&&(s[u]=t[u]);s.originalType=e,s[c]="string"==typeof e?e:n,l[1]=s;for(var i=2;i<a;i++)l[i]=o[i];return r.createElement.apply(null,l)}return r.createElement.apply(null,o)}m.displayName="MDXCreateElement"},14217:(e,t,o)=>{o.r(t),o.d(t,{assets:()=>p,contentTitle:()=>u,default:()=>f,frontMatter:()=>s,metadata:()=>i,toc:()=>c});var r=o(87462),n=o(63366),a=(o(67294),o(3905)),l=["components"],s={id:"sips-workflow",title:"Science Investigator-led Processing Systems (SIPS)",hide_title:!1},u=void 0,i={unversionedId:"data-cookbooks/sips-workflow",id:"version-v16.0.0/data-cookbooks/sips-workflow",title:"Science Investigator-led Processing Systems (SIPS)",description:"The Cumulus ingest workflow supports the SIPS workflow. In the following document, we'll discuss what a SIPS workflow is and how to set one up in a Cumulus instance.",source:"@site/versioned_docs/version-v16.0.0/data-cookbooks/sips-workflow.md",sourceDirName:"data-cookbooks",slug:"/data-cookbooks/sips-workflow",permalink:"/cumulus/docs/data-cookbooks/sips-workflow",draft:!1,tags:[],version:"v16.0.0",lastUpdatedBy:"Nate Pauzenga",lastUpdatedAt:1689363144,formattedLastUpdatedAt:"Jul 14, 2023",frontMatter:{id:"sips-workflow",title:"Science Investigator-led Processing Systems (SIPS)",hide_title:!1},sidebar:"docs",previous:{title:"Ingest Notification in Workflows",permalink:"/cumulus/docs/data-cookbooks/ingest-notifications"},next:{title:"CNM Workflow",permalink:"/cumulus/docs/data-cookbooks/cnm-workflow"}},p={},c=[{value:"Setup",id:"setup",level:2},{value:"Provider",id:"provider",level:3},{value:"Collection",id:"collection",level:3},{value:"Rule",id:"rule",level:3},{value:"DiscoverAndQueuePdrs Workflow",id:"discoverandqueuepdrs-workflow",level:2},{value:"ParsePdr Workflow",id:"parsepdr-workflow",level:2},{value:"IngestGranule Workflow",id:"ingestgranule-workflow",level:2},{value:"Summary",id:"summary",level:2}],d={toc:c},m="wrapper";function f(e){var t=e.components,s=(0,n.Z)(e,l);return(0,a.kt)(m,(0,r.Z)({},d,s,{components:t,mdxType:"MDXLayout"}),(0,a.kt)("p",null,"The Cumulus ingest workflow supports the SIPS workflow. In the following document, we'll discuss what a SIPS workflow is and how to set one up in a Cumulus instance."),(0,a.kt)("p",null,"In this document, we assume the user already has a provider endpoint configured and ready with some data to ingest. We'll be using an S3 provider and ingesting from a MOD09GQ collection."),(0,a.kt)("h2",{id:"setup"},"Setup"),(0,a.kt)("h3",{id:"provider"},"Provider"),(0,a.kt)("p",null,"We need to have a ",(0,a.kt)("a",{parentName:"p",href:"/cumulus/docs/configuration/data-management-types#providers"},"provider")," from whom data can be ingested. Our provider is an S3 provider hosted in the ",(0,a.kt)("inlineCode",{parentName:"p"},"cumulus-test-internal")," bucket."),(0,a.kt)("p",null,(0,a.kt)("img",{alt:"Screenshot of Cumulus dashboard screen for configuring an S3 provider",src:o(72108).Z,width:"1075",height:"602"})),(0,a.kt)("h3",{id:"collection"},"Collection"),(0,a.kt)("p",null,"We need to build a collection. Details on collections can be found\n",(0,a.kt)("a",{parentName:"p",href:"/cumulus/docs/configuration/data-management-types#collections"},"here"),". The following collection will have\n",(0,a.kt)("inlineCode",{parentName:"p"},"MOD09GQ")," as a collection name, ",(0,a.kt)("inlineCode",{parentName:"p"},"006")," as a version."),(0,a.kt)("pre",null,(0,a.kt)("code",{parentName:"pre",className:"language-json"},'{\n  "name": "MOD09GQ",\n  "version": "006",\n  "process": "modis",\n  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",\n  "granuleIdExtraction": "(MOD09GQ\\\\..*)(\\\\.hdf|\\\\.cmr|_ndvi\\\\.jpg)",\n  "granuleId": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}$",\n  "files": [\n    {\n      "bucket": "protected",\n      "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\.hdf$",\n      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",\n      "url_path": "{cmrMetadata.Granule.Collection.ShortName}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.fileName, 0, 3)}"\n    },\n    {\n      "bucket": "private",\n      "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\.hdf\\\\.met$",\n      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met"\n    },\n    {\n      "bucket": "protected-2",\n      "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\.cmr\\\\.xml$",\n      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml"\n    },\n    {\n      "bucket": "public",\n      "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}_ndvi\\\\.jpg$",\n      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_ndvi.jpg"\n    }\n  ],\n  "duplicateHandling": "replace",\n  "url_path": "{cmrMetadata.Granule.Collection.ShortName}/{substring(file.fileName, 0, 3)}",\n}\n')),(0,a.kt)("h3",{id:"rule"},"Rule"),(0,a.kt)("p",null,"Finally, let's create a ",(0,a.kt)("a",{parentName:"p",href:"/cumulus/docs/configuration/data-management-types#rules"},"rule"),". In this example\nwe're just going to create a ",(0,a.kt)("inlineCode",{parentName:"p"},"onetime")," throw-away rule that will be easy to test\nwith. This rule will kick off the ",(0,a.kt)("inlineCode",{parentName:"p"},"DiscoverAndQueuePdrs")," workflow, which is the\nbeginning of a Cumulus SIPS workflow:"),(0,a.kt)("p",null,(0,a.kt)("img",{alt:"Screenshot of a Cumulus rule configuration",src:o(93961).Z,width:"2448",height:"1784"})),(0,a.kt)("p",null,(0,a.kt)("strong",{parentName:"p"},"Note:"),' A list of configured workflows exists under the "Workflows" in the navigation bar on the Cumulus dashboard. Additionally, one can find a list of executions and their respective status in the "Executions" tab in the navigation bar.'),(0,a.kt)("h2",{id:"discoverandqueuepdrs-workflow"},"DiscoverAndQueuePdrs Workflow"),(0,a.kt)("p",null,"This workflow will discover PDRs and queue them to be processed. Duplicate PDRs will be dealt with according to the configured duplicate handling setting in the collection.   The lambdas below are included in the ",(0,a.kt)("inlineCode",{parentName:"p"},"cumulus")," terraform module for use in your workflows:"),(0,a.kt)("ol",null,(0,a.kt)("li",{parentName:"ol"},"DiscoverPdrs - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs"},"source")),(0,a.kt)("li",{parentName:"ol"},"QueuePdrs - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs"},"source"))),(0,a.kt)("p",null,(0,a.kt)("img",{alt:"Screenshot of execution graph for discover and queue PDRs workflow in the AWS Step Functions console",src:o(57084).Z,width:"312",height:"411"})),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},"An example workflow module configuration can be viewed in the Cumulus source for the ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/discover_and_queue_pdrs_workflow.tf"},"discover_and_queue_pdrs_workflow"),".")),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},(0,a.kt)("strong",{parentName:"em"},"Please note:")," To use this example workflow module as a template for a new workflow in your deployment the ",(0,a.kt)("inlineCode",{parentName:"em"},"source")," key for the workflow module would need to point to a release of the cumulus-workflow (terraform-aws-cumulus-workflow.zip) module on our ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/releases"},"release")," page, as all of the provided Cumulus workflows are internally self-referential.")),(0,a.kt)("h2",{id:"parsepdr-workflow"},"ParsePdr Workflow"),(0,a.kt)("p",null,"The ParsePdr workflow will parse a PDR, queue the specified granules (duplicates are handled according to the duplicate handling setting) and periodically check the status of those queued granules. This workflow will not succeed until all the granules included in the PDR are successfully ingested. If one of those fails, the ParsePdr workflow will fail. ",(0,a.kt)("strong",{parentName:"p"},"NOTE")," that ParsePdr may spin up multiple IngestGranule workflows in parallel, depending on the granules included in the PDR."),(0,a.kt)("p",null,"The lambdas below are included in the ",(0,a.kt)("inlineCode",{parentName:"p"},"cumulus")," terraform module for use in your workflows:"),(0,a.kt)("ol",null,(0,a.kt)("li",{parentName:"ol"},"ParsePdr - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr"},"source")),(0,a.kt)("li",{parentName:"ol"},"QueueGranules - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-granules"},"source")),(0,a.kt)("li",{parentName:"ol"},"CheckStatus - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check"},"source"))),(0,a.kt)("p",null,(0,a.kt)("img",{alt:"Screenshot of execution graph for SIPS Parse PDR workflow in AWS Step Functions console",src:o(83715).Z,width:"682",height:"562"})),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},"An example workflow module configuration can be viewed in the Cumulus source for the ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/parse_pdr_workflow.tf"},"parse_pdr_workflow"),".")),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},(0,a.kt)("strong",{parentName:"em"},"Please note:")," To use this example workflow module as a template for a new workflow in your deployment the ",(0,a.kt)("inlineCode",{parentName:"em"},"source")," key for the workflow module would need to point to a release of the cumulus-workflow (terraform-aws-cumulus-workflow.zip) module on our ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/releases"},"release")," page, as all of the provided Cumulus workflows are internally self-referential.")),(0,a.kt)("h2",{id:"ingestgranule-workflow"},"IngestGranule Workflow"),(0,a.kt)("p",null,"The IngestGranule workflow processes and ingests a granule and posts the granule metadata to CMR."),(0,a.kt)("p",null,"The lambdas below are included in the ",(0,a.kt)("inlineCode",{parentName:"p"},"cumulus")," terraform module for use in your workflows:"),(0,a.kt)("ol",null,(0,a.kt)("li",{parentName:"ol"},"SyncGranule - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/sync-granule"},"source"),"."),(0,a.kt)("li",{parentName:"ol"},"CmrStep - ",(0,a.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr"},"source"))),(0,a.kt)("p",null,"Additionally this workflow requires a processing step you must provide. The ProcessingStep step in the workflow picture below is an example of a custom processing step."),(0,a.kt)("p",null,(0,a.kt)("strong",{parentName:"p"},"Note:")," Using the CmrStep is not required and can be left out of the processing trajectory if desired (for example, in testing situations)."),(0,a.kt)("p",null,(0,a.kt)("img",{alt:"Screenshot of execution graph for SIPS IngestGranule workflow in AWS Step Functions console",src:o(15801).Z,width:"482",height:"559"})),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},"An example workflow module configuration can be viewed in the Cumulus source for the ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.tf"},"ingest_and_publish_granule_workflow"),".")),(0,a.kt)("p",null,(0,a.kt)("em",{parentName:"p"},(0,a.kt)("strong",{parentName:"em"},"Please note:")," To use this example workflow module as a template for a new workflow in your deployment the ",(0,a.kt)("inlineCode",{parentName:"em"},"source")," key for the workflow module would need to point to a release of the cumulus-workflow (terraform-aws-cumulus-workflow.zip) module on our ",(0,a.kt)("a",{parentName:"em",href:"https://github.com/nasa/cumulus/releases"},"release")," page, as all of the provided Cumulus workflows are internally self-referential.")),(0,a.kt)("h2",{id:"summary"},"Summary"),(0,a.kt)("p",null,"In this cookbook we went over setting up a collection, rule, and provider for a SIPS workflow. Once we had the setup completed, we looked over the Cumulus workflows that participate in parsing PDRs, ingesting and processing granules, and updating CMR."))}f.isMDXComponent=!0},93961:(e,t,o)=>{o.d(t,{Z:()=>r});const r=o.p+"assets/images/add_rule-39d552773bdb983a8e9fd3a55206b251.png"},57084:(e,t,o)=>{o.d(t,{Z:()=>r});const r=o.p+"assets/images/sips-discover-and-queue-pdrs-execution-c0e1700ee15ad88dab703e18a7567652.png"},15801:(e,t,o)=>{o.d(t,{Z:()=>r});const r=o.p+"assets/images/sips-ingest-granule-210e4cd5620a4959e9200e1de6a91b13.png"},83715:(e,t,o)=>{o.d(t,{Z:()=>r});const r=o.p+"assets/images/sips-parse-pdr-a8b1649e0c226d9552b36f8c790f8059.png"},72108:(e,t,o)=>{o.d(t,{Z:()=>r});const r=o.p+"assets/images/sips-provider-7f4b6505a7be7748ebac8acdb03f730f.png"}}]);