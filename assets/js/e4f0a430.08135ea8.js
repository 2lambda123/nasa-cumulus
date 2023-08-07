"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[21089],{3905:(e,t,n)=>{n.d(t,{Zo:()=>u,kt:()=>f});var a=n(67294);function r(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function o(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);t&&(a=a.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,a)}return n}function c(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?o(Object(n),!0).forEach((function(t){r(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):o(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function i(e,t){if(null==e)return{};var n,a,r=function(e,t){if(null==e)return{};var n,a,r={},o=Object.keys(e);for(a=0;a<o.length;a++)n=o[a],t.indexOf(n)>=0||(r[n]=e[n]);return r}(e,t);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(a=0;a<o.length;a++)n=o[a],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(r[n]=e[n])}return r}var l=a.createContext({}),s=function(e){var t=a.useContext(l),n=t;return e&&(n="function"==typeof e?e(t):c(c({},t),e)),n},u=function(e){var t=s(e.components);return a.createElement(l.Provider,{value:t},e.children)},p="mdxType",m={inlineCode:"code",wrapper:function(e){var t=e.children;return a.createElement(a.Fragment,{},t)}},d=a.forwardRef((function(e,t){var n=e.components,r=e.mdxType,o=e.originalType,l=e.parentName,u=i(e,["components","mdxType","originalType","parentName"]),p=s(n),d=r,f=p["".concat(l,".").concat(d)]||p[d]||m[d]||o;return n?a.createElement(f,c(c({ref:t},u),{},{components:n})):a.createElement(f,c({ref:t},u))}));function f(e,t){var n=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var o=n.length,c=new Array(o);c[0]=d;var i={};for(var l in t)hasOwnProperty.call(t,l)&&(i[l]=t[l]);i.originalType=e,i[p]="string"==typeof e?e:r,c[1]=i;for(var s=2;s<o;s++)c[s]=n[s];return a.createElement.apply(null,c)}return a.createElement.apply(null,n)}d.displayName="MDXCreateElement"},74075:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>u,contentTitle:()=>l,default:()=>f,frontMatter:()=>i,metadata:()=>s,toc:()=>p});var a=n(87462),r=n(63366),o=(n(67294),n(3905)),c=["components"],i={id:"create_bucket",title:"Creating an S3 Bucket",hide_title:!1},l=void 0,s={unversionedId:"deployment/create_bucket",id:"version-v16.1.1/deployment/create_bucket",title:"Creating an S3 Bucket",description:"Buckets can be created on the command line with AWS CLI or via the web interface on the AWS console.",source:"@site/versioned_docs/version-v16.1.1/deployment/create_bucket.md",sourceDirName:"deployment",slug:"/deployment/create_bucket",permalink:"/cumulus/docs/deployment/create_bucket",draft:!1,tags:[],version:"v16.1.1",lastUpdatedBy:"Nate Pauzenga",lastUpdatedAt:1691427107,formattedLastUpdatedAt:"Aug 7, 2023",frontMatter:{id:"create_bucket",title:"Creating an S3 Bucket",hide_title:!1},sidebar:"docs",previous:{title:"How to Deploy Cumulus",permalink:"/cumulus/docs/deployment/"},next:{title:"Terraform Best Practices",permalink:"/cumulus/docs/deployment/terraform-best-practices"}},u={},p=[{value:"Command Line",id:"command-line",level:2},{value:"Web Interface",id:"web-interface",level:2}],m={toc:p},d="wrapper";function f(e){var t=e.components,n=(0,r.Z)(e,c);return(0,o.kt)(d,(0,a.Z)({},m,n,{components:t,mdxType:"MDXLayout"}),(0,o.kt)("p",null,"Buckets can be created on the command line with ",(0,o.kt)("a",{parentName:"p",href:"https://aws.amazon.com/cli/",title:"Amazon Command Line Interface"},"AWS CLI")," or via the web interface on the ",(0,o.kt)("a",{parentName:"p",href:"http://docs.aws.amazon.com/AmazonS3/latest/gsg/CreatingABucket.html",title:"Amazon web console interface"},"AWS console"),"."),(0,o.kt)("p",null,"When creating a protected bucket (a bucket containing data which will be served through the distribution API), make sure to enable S3 server access logging. See ",(0,o.kt)("a",{parentName:"p",href:"/cumulus/docs/configuration/server_access_logging"},"S3 Server Access Logging")," for more details."),(0,o.kt)("h2",{id:"command-line"},"Command Line"),(0,o.kt)("p",null,"Using the ",(0,o.kt)("a",{parentName:"p",href:"https://aws.amazon.com/cli/",title:"Amazon Command Line Interface"},"AWS Command Line Tool")," ",(0,o.kt)("a",{parentName:"p",href:"https://docs.aws.amazon.com/cli/latest/reference/s3api/create-bucket.html"},"create-bucket")," ",(0,o.kt)("inlineCode",{parentName:"p"},"s3api")," subcommand:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-bash"},'$ aws s3api create-bucket \\\n    --bucket foobar-internal \\\n    --region us-west-2 \\\n    --create-bucket-configuration LocationConstraint=us-west-2\n{\n    "Location": "/foobar-internal"\n}\n')),(0,o.kt)("admonition",{type:"info"},(0,o.kt)("p",{parentName:"admonition"},"The ",(0,o.kt)("inlineCode",{parentName:"p"},"region")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"create-bucket-configuration")," arguments are only necessary if you are creating a bucket outside of the ",(0,o.kt)("inlineCode",{parentName:"p"},"us-east-1")," region.")),(0,o.kt)("p",null,"Please note security settings and other bucket options can be set via the options listed in the ",(0,o.kt)("inlineCode",{parentName:"p"},"s3api")," documentation."),(0,o.kt)("p",null,"Repeat the above step for each bucket to be created."),(0,o.kt)("h2",{id:"web-interface"},"Web Interface"),(0,o.kt)("p",null,"If you prefer to use the AWS web interface instead of the command line, see ",(0,o.kt)("a",{parentName:"p",href:"http://docs.aws.amazon.com/AmazonS3/latest/gsg/CreatingABucket.html",title:"Amazon web console interface"},'AWS "Creating a Bucket" documentation'),"."))}f.isMDXComponent=!0}}]);