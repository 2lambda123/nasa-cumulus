"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[89984],{3905:(e,t,s)=>{s.d(t,{Zo:()=>i,kt:()=>k});var a=s(67294);function u(e,t,s){return t in e?Object.defineProperty(e,t,{value:s,enumerable:!0,configurable:!0,writable:!0}):e[t]=s,e}function r(e,t){var s=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);t&&(a=a.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),s.push.apply(s,a)}return s}function l(e){for(var t=1;t<arguments.length;t++){var s=null!=arguments[t]?arguments[t]:{};t%2?r(Object(s),!0).forEach((function(t){u(e,t,s[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(s)):r(Object(s)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(s,t))}))}return e}function m(e,t){if(null==e)return{};var s,a,u=function(e,t){if(null==e)return{};var s,a,u={},r=Object.keys(e);for(a=0;a<r.length;a++)s=r[a],t.indexOf(s)>=0||(u[s]=e[s]);return u}(e,t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);for(a=0;a<r.length;a++)s=r[a],t.indexOf(s)>=0||Object.prototype.propertyIsEnumerable.call(e,s)&&(u[s]=e[s])}return u}var n=a.createContext({}),c=function(e){var t=a.useContext(n),s=t;return e&&(s="function"==typeof e?e(t):l(l({},t),e)),s},i=function(e){var t=c(e.components);return a.createElement(n.Provider,{value:t},e.children)},p="mdxType",h={inlineCode:"code",wrapper:function(e){var t=e.children;return a.createElement(a.Fragment,{},t)}},o=a.forwardRef((function(e,t){var s=e.components,u=e.mdxType,r=e.originalType,n=e.parentName,i=m(e,["components","mdxType","originalType","parentName"]),p=c(s),o=u,k=p["".concat(n,".").concat(o)]||p[o]||h[o]||r;return s?a.createElement(k,l(l({ref:t},i),{},{components:s})):a.createElement(k,l({ref:t},i))}));function k(e,t){var s=arguments,u=t&&t.mdxType;if("string"==typeof e||u){var r=s.length,l=new Array(r);l[0]=o;var m={};for(var n in t)hasOwnProperty.call(t,n)&&(m[n]=t[n]);m.originalType=e,m[p]="string"==typeof e?e:u,l[1]=m;for(var c=2;c<r;c++)l[c]=s[c];return a.createElement.apply(null,l)}return a.createElement.apply(null,s)}o.displayName="MDXCreateElement"},31662:(e,t,s)=>{s.r(t),s.d(t,{assets:()=>i,contentTitle:()=>n,default:()=>k,frontMatter:()=>m,metadata:()=>c,toc:()=>p});var a=s(87462),u=s(63366),r=(s(67294),s(3905)),l=["components"],m={id:"tasks",title:"Cumulus Tasks",hide_title:!1},n=void 0,c={unversionedId:"tasks",id:"version-v16.0.0/tasks",title:"Cumulus Tasks",description:"A list of reusable Cumulus tasks. Add your own.",source:"@site/versioned_docs/version-v16.0.0/tasks.md",sourceDirName:".",slug:"/tasks",permalink:"/cumulus/docs/v16.0.0/tasks",draft:!1,tags:[],version:"v16.0.0",lastUpdatedBy:"Nate Pauzenga",lastUpdatedAt:1689363144,formattedLastUpdatedAt:"Jul 14, 2023",frontMatter:{id:"tasks",title:"Cumulus Tasks",hide_title:!1},sidebar:"docs",previous:{title:"Workflow Tasks",permalink:"/cumulus/docs/v16.0.0/category/workflow-tasks"},next:{title:"Cumulus Tasks: Message Flow",permalink:"/cumulus/docs/v16.0.0/workflows/cumulus-task-message-flow"}},i={},p=[{value:"Tasks",id:"tasks",level:2},{value:"@cumulus/add-missing-file-checksums",id:"cumulusadd-missing-file-checksums",level:3},{value:"@cumulus/discover-granules",id:"cumulusdiscover-granules",level:3},{value:"@cumulus/discover-pdrs",id:"cumulusdiscover-pdrs",level:3},{value:"@cumulus/files-to-granules",id:"cumulusfiles-to-granules",level:3},{value:"@cumulus/hello-world",id:"cumulushello-world",level:3},{value:"@cumulus/hyrax-metadata-updates",id:"cumulushyrax-metadata-updates",level:3},{value:"@cumulus/lzards-backup",id:"cumuluslzards-backup",level:3},{value:"@cumulus/move-granules",id:"cumulusmove-granules",level:3},{value:"@cumulus/parse-pdr",id:"cumulusparse-pdr",level:3},{value:"@cumulus/pdr-status-check",id:"cumuluspdr-status-check",level:3},{value:"@cumulus/post-to-cmr",id:"cumuluspost-to-cmr",level:3},{value:"@cumulus/queue-granules",id:"cumulusqueue-granules",level:3},{value:"@cumulus/queue-pdrs",id:"cumulusqueue-pdrs",level:3},{value:"@cumulus/queue-workflow",id:"cumulusqueue-workflow",level:3},{value:"@cumulus/sf-sqs-report",id:"cumulussf-sqs-report",level:3},{value:"@cumulus/sync-granule",id:"cumulussync-granule",level:3},{value:"@cumulus/test-processing",id:"cumulustest-processing",level:3},{value:"@cumulus/update-cmr-access-constraints",id:"cumulusupdate-cmr-access-constraints",level:3},{value:"@cumulus/update-granules-cmr-metadata-file-links",id:"cumulusupdate-granules-cmr-metadata-file-links",level:3}],h={toc:p},o="wrapper";function k(e){var t=e.components,s=(0,u.Z)(e,l);return(0,r.kt)(o,(0,a.Z)({},h,s,{components:t,mdxType:"MDXLayout"}),(0,r.kt)("p",null,"A list of reusable Cumulus tasks. ",(0,r.kt)("a",{parentName:"p",href:"/cumulus/docs/v16.0.0/adding-a-task"},"Add your own.")),(0,r.kt)("h2",{id:"tasks"},"Tasks"),(0,r.kt)("h3",{id:"cumulusadd-missing-file-checksums"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme"},"@cumulus/add-missing-file-checksums")),(0,r.kt)("p",null,"Add checksums to files in S3 which don't have one"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/add-missing-file-checksums"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusdiscover-granules"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-granules"},"@cumulus/discover-granules")),(0,r.kt)("p",null,"Discover Granules in FTP/HTTP/HTTPS/SFTP/S3 endpoints"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-granules/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/discover-granules"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-granules"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusdiscover-pdrs"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs"},"@cumulus/discover-pdrs")),(0,r.kt)("p",null,"Discover PDRs in FTP and HTTP endpoints"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/discover-pdrs"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusfiles-to-granules"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules"},"@cumulus/files-to-granules")),(0,r.kt)("p",null,"Converts array-of-files input into a granules object by extracting granuleId from filename"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/files-to-granules"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulushello-world"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/hello-world"},"@cumulus/hello-world")),(0,r.kt)("p",null,"Example task"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/hello-world/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/hello-world"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/hello-world"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulushyrax-metadata-updates"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates"},"@cumulus/hyrax-metadata-updates")),(0,r.kt)("p",null,"Update granule metadata with hooks to OPeNDAP URL"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/hyrax-metadata-updates"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumuluslzards-backup"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme"},"@cumulus/lzards-backup")),(0,r.kt)("p",null,"Run LZARDS backup"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/lzards-backup"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusmove-granules"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/move-granules"},"@cumulus/move-granules")),(0,r.kt)("p",null,"Move granule files from staging to final location"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/move-granules/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/move-granules"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/move-granules"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusparse-pdr"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr"},"@cumulus/parse-pdr")),(0,r.kt)("p",null,"Download and Parse a given PDR"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/parse-pdr"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumuluspdr-status-check"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check"},"@cumulus/pdr-status-check")),(0,r.kt)("p",null,"Checks execution status of granules in a PDR"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/pdr-status-check"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumuluspost-to-cmr"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr"},"@cumulus/post-to-cmr")),(0,r.kt)("p",null,"Post a given granule to CMR"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/post-to-cmr"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusqueue-granules"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-granules"},"@cumulus/queue-granules")),(0,r.kt)("p",null,"Add discovered granules to the queue"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-granules/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/queue-granules"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-granules"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusqueue-pdrs"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs"},"@cumulus/queue-pdrs")),(0,r.kt)("p",null,"Add discovered PDRs to a queue"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/queue-pdrs"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusqueue-workflow"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow"},"@cumulus/queue-workflow")),(0,r.kt)("p",null,"Add workflow to the queue"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/queue-workflow"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulussf-sqs-report"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report"},"@cumulus/sf-sqs-report")),(0,r.kt)("p",null,"Sends an incoming Cumulus message to SQS"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/sf-sqs-report"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulussync-granule"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/sync-granule"},"@cumulus/sync-granule")),(0,r.kt)("p",null,"Download a given granule"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/sync-granule/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/sync-granule"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/sync-granule"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulustest-processing"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/test-processing"},"@cumulus/test-processing")),(0,r.kt)("p",null,"Fake processing task used for integration tests"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/test-processing/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/test-processing"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/test-processing"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusupdate-cmr-access-constraints"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme"},"@cumulus/update-cmr-access-constraints")),(0,r.kt)("p",null,"Updates CMR metadata to set access constraints"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/update-cmr-access-constraints"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme"},"web"))),(0,r.kt)("hr",null),(0,r.kt)("h3",{id:"cumulusupdate-granules-cmr-metadata-file-links"},(0,r.kt)("a",{parentName:"h3",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links"},"@cumulus/update-granules-cmr-metadata-file-links")),(0,r.kt)("p",null,"Update CMR metadata files with correct online access urls and etags and transfer etag info to granules' CMR files"),(0,r.kt)("ul",null,(0,r.kt)("li",{parentName:"ul"},"Schemas: See this module's ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links/schemas"},"schema definitions"),"."),(0,r.kt)("li",{parentName:"ul"},"Resources: ",(0,r.kt)("a",{parentName:"li",href:"https://npmjs.com/package/@cumulus/update-granules-cmr-metadata-file-links"},"npm")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus"},"source")," | ",(0,r.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links"},"web"))))}k.isMDXComponent=!0}}]);