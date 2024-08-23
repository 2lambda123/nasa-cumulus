"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[2415],{15680:(e,t,a)=>{a.d(t,{xA:()=>d,yg:()=>g});var r=a(96540);function s(e,t,a){return t in e?Object.defineProperty(e,t,{value:a,enumerable:!0,configurable:!0,writable:!0}):e[t]=a,e}function o(e,t){var a=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),a.push.apply(a,r)}return a}function u(e){for(var t=1;t<arguments.length;t++){var a=null!=arguments[t]?arguments[t]:{};t%2?o(Object(a),!0).forEach((function(t){s(e,t,a[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(a)):o(Object(a)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(a,t))}))}return e}function n(e,t){if(null==e)return{};var a,r,s=function(e,t){if(null==e)return{};var a,r,s={},o=Object.keys(e);for(r=0;r<o.length;r++)a=o[r],t.indexOf(a)>=0||(s[a]=e[a]);return s}(e,t);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(r=0;r<o.length;r++)a=o[r],t.indexOf(a)>=0||Object.prototype.propertyIsEnumerable.call(e,a)&&(s[a]=e[a])}return s}var l=r.createContext({}),i=function(e){var t=r.useContext(l),a=t;return e&&(a="function"==typeof e?e(t):u(u({},t),e)),a},d=function(e){var t=i(e.components);return r.createElement(l.Provider,{value:t},e.children)},c="mdxType",p={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},m=r.forwardRef((function(e,t){var a=e.components,s=e.mdxType,o=e.originalType,l=e.parentName,d=n(e,["components","mdxType","originalType","parentName"]),c=i(a),m=s,g=c["".concat(l,".").concat(m)]||c[m]||p[m]||o;return a?r.createElement(g,u(u({ref:t},d),{},{components:a})):r.createElement(g,u({ref:t},d))}));function g(e,t){var a=arguments,s=t&&t.mdxType;if("string"==typeof e||s){var o=a.length,u=new Array(o);u[0]=m;var n={};for(var l in t)hasOwnProperty.call(t,l)&&(n[l]=t[l]);n.originalType=e,n[c]="string"==typeof e?e:s,u[1]=n;for(var i=2;i<o;i++)u[i]=a[i];return r.createElement.apply(null,u)}return r.createElement.apply(null,a)}m.displayName="MDXCreateElement"},51398:(e,t,a)=>{a.r(t),a.d(t,{assets:()=>d,contentTitle:()=>l,default:()=>g,frontMatter:()=>n,metadata:()=>i,toc:()=>c});var r=a(58168),s=a(98587),o=(a(96540),a(15680)),u=["components"],n={id:"dead_letter_queues",title:"Dead Letter Queues",hide_title:!1},l=void 0,i={unversionedId:"features/dead_letter_queues",id:"version-v18.4.0/features/dead_letter_queues",title:"Dead Letter Queues",description:"startSF SQS queue",source:"@site/versioned_docs/version-v18.4.0/features/lambda_dead_letter_queue.md",sourceDirName:"features",slug:"/features/dead_letter_queues",permalink:"/cumulus/docs/features/dead_letter_queues",draft:!1,tags:[],version:"v18.4.0",lastUpdatedBy:"Naga Nages",lastUpdatedAt:1724195783,formattedLastUpdatedAt:"Aug 20, 2024",frontMatter:{id:"dead_letter_queues",title:"Dead Letter Queues",hide_title:!1},sidebar:"docs",previous:{title:"Cumulus Backup and Restore",permalink:"/cumulus/docs/features/backup_and_restore"},next:{title:"Cumulus Dead Letter Archive",permalink:"/cumulus/docs/features/dead_letter_archive"}},d={},c=[{value:"startSF SQS queue",id:"startsf-sqs-queue",level:2},{value:"Named Lambda Dead Letter Queues",id:"named-lambda-dead-letter-queues",level:2},{value:"<strong>Default Lambda Configuration</strong>",id:"default-lambda-configuration",level:3},{value:"Troubleshooting/Utilizing messages in a Dead Letter Queue",id:"troubleshootingutilizing-messages-in-a-dead-letter-queue",level:2}],p={toc:c},m="wrapper";function g(e){var t=e.components,n=(0,s.A)(e,u);return(0,o.yg)(m,(0,r.A)({},p,n,{components:t,mdxType:"MDXLayout"}),(0,o.yg)("h2",{id:"startsf-sqs-queue"},"startSF SQS queue"),(0,o.yg)("p",null,"The ",(0,o.yg)("a",{parentName:"p",href:"../workflows/workflow-triggers"},"workflow-trigger")," for the startSF queue has a ",(0,o.yg)("a",{parentName:"p",href:"https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-sqs-queues-redrivepolicy.html"},"Redrive Policy")," set up that directs any failed attempts to pull from the workflow start queue to a SQS queue ",(0,o.yg)("a",{parentName:"p",href:"https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html"},"Dead Letter Queue"),"."),(0,o.yg)("p",null,"This queue can then be monitored for failures to initiate a workflow.   Please note that workflow failures will not show up in this queue, only repeated failure to trigger a workflow."),(0,o.yg)("h2",{id:"named-lambda-dead-letter-queues"},"Named Lambda Dead Letter Queues"),(0,o.yg)("p",null,"Cumulus provides configured ",(0,o.yg)("a",{parentName:"p",href:"https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html"},"Dead Letter Queues")," (",(0,o.yg)("inlineCode",{parentName:"p"},"DLQ"),") for non-workflow Lambdas (such as ScheduleSF) to capture Lambda failures for further processing."),(0,o.yg)("p",null,"These DLQs are setup with the following configuration:"),(0,o.yg)("pre",null,(0,o.yg)("code",{parentName:"pre",className:"language-hcl"},"  receive_wait_time_seconds  = 20\n  message_retention_seconds  = 1209600\n  visibility_timeout_seconds = 60\n")),(0,o.yg)("h3",{id:"default-lambda-configuration"},(0,o.yg)("strong",{parentName:"h3"},"Default Lambda Configuration")),(0,o.yg)("p",null,"The following built-in Cumulus Lambdas are setup with DLQs to allow handling of process failures:"),(0,o.yg)("ul",null,(0,o.yg)("li",{parentName:"ul"},"dbIndexer (Updates Elasticsearch)"),(0,o.yg)("li",{parentName:"ul"},"JobsLambda (writes logs outputs to Elasticsearch)"),(0,o.yg)("li",{parentName:"ul"},"ScheduleSF (the SF Scheduler Lambda that places messages on the queue that is used to start workflows, see ",(0,o.yg)("a",{parentName:"li",href:"/cumulus/docs/workflows/workflow-triggers"},"Workflow Triggers"),")"),(0,o.yg)("li",{parentName:"ul"},"publishReports  (Lambda that publishes messages to the SNS topics for execution, granule and PDR reporting)"),(0,o.yg)("li",{parentName:"ul"},"reportGranules, reportExecutions, reportPdrs (Lambdas responsible for updating records based on messages in the queues published by publishReports)")),(0,o.yg)("h2",{id:"troubleshootingutilizing-messages-in-a-dead-letter-queue"},"Troubleshooting/Utilizing messages in a ",(0,o.yg)("a",{parentName:"h2",href:"https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html"},"Dead Letter Queue")),(0,o.yg)("p",null,"Ideally an automated process should be configured to poll the queue and process messages off a dead letter queue."),(0,o.yg)("p",null,"For aid in manually troubleshooting, you can utilize the ",(0,o.yg)("a",{parentName:"p",href:"https://console.aws.amazon.com/sqs/home"},"SQS Management console")," to view/messages available in the queues setup for a particular stack.    The dead letter queues will have a Message Body containing the Lambda payload, as well as Message Attributes that reference both the error returned and a RequestID which can be cross referenced to the associated Lambda's CloudWatch logs for more information:"),(0,o.yg)("p",null,(0,o.yg)("img",{alt:"Screenshot of the AWS SQS console showing how to view SQS message attributes",src:a(39411).A,width:"657",height:"553"})))}g.isMDXComponent=!0},39411:(e,t,a)=>{a.d(t,{A:()=>r});const r=a.p+"assets/images/sqs_message_attribute-f4cac0e790fb9506641e398dca7d3f19.png"}}]);