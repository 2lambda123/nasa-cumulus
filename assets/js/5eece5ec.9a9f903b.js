"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[38679],{3905:(e,t,a)=>{a.d(t,{Zo:()=>p,kt:()=>f});var n=a(67294);function r(e,t,a){return t in e?Object.defineProperty(e,t,{value:a,enumerable:!0,configurable:!0,writable:!0}):e[t]=a,e}function o(e,t){var a=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),a.push.apply(a,n)}return a}function s(e){for(var t=1;t<arguments.length;t++){var a=null!=arguments[t]?arguments[t]:{};t%2?o(Object(a),!0).forEach((function(t){r(e,t,a[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(a)):o(Object(a)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(a,t))}))}return e}function i(e,t){if(null==e)return{};var a,n,r=function(e,t){if(null==e)return{};var a,n,r={},o=Object.keys(e);for(n=0;n<o.length;n++)a=o[n],t.indexOf(a)>=0||(r[a]=e[a]);return r}(e,t);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(n=0;n<o.length;n++)a=o[n],t.indexOf(a)>=0||Object.prototype.propertyIsEnumerable.call(e,a)&&(r[a]=e[a])}return r}var l=n.createContext({}),u=function(e){var t=n.useContext(l),a=t;return e&&(a="function"==typeof e?e(t):s(s({},t),e)),a},p=function(e){var t=u(e.components);return n.createElement(l.Provider,{value:t},e.children)},d="mdxType",m={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},c=n.forwardRef((function(e,t){var a=e.components,r=e.mdxType,o=e.originalType,l=e.parentName,p=i(e,["components","mdxType","originalType","parentName"]),d=u(a),c=r,f=d["".concat(l,".").concat(c)]||d[c]||m[c]||o;return a?n.createElement(f,s(s({ref:t},p),{},{components:a})):n.createElement(f,s({ref:t},p))}));function f(e,t){var a=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var o=a.length,s=new Array(o);s[0]=c;var i={};for(var l in t)hasOwnProperty.call(t,l)&&(i[l]=t[l]);i.originalType=e,i[d]="string"==typeof e?e:r,s[1]=i;for(var u=2;u<o;u++)s[u]=a[u];return n.createElement.apply(null,s)}return n.createElement.apply(null,a)}c.displayName="MDXCreateElement"},8671:(e,t,a)=>{a.r(t),a.d(t,{assets:()=>p,contentTitle:()=>l,default:()=>f,frontMatter:()=>i,metadata:()=>u,toc:()=>d});var n=a(87462),r=a(63366),o=(a(67294),a(3905)),s=["components"],i={id:"postgres_database_deployment",title:"PostgreSQL Database Deployment",hide_title:!1},l=void 0,u={unversionedId:"deployment/postgres_database_deployment",id:"deployment/postgres_database_deployment",title:"PostgreSQL Database Deployment",description:"Overview",source:"@site/../docs/deployment/postgres-database-deployment.md",sourceDirName:"deployment",slug:"/deployment/postgres_database_deployment",permalink:"/cumulus/docs/next/deployment/postgres_database_deployment",draft:!1,tags:[],version:"current",lastUpdatedBy:"jennyhliu",lastUpdatedAt:1678406688,formattedLastUpdatedAt:"Mar 10, 2023",frontMatter:{id:"postgres_database_deployment",title:"PostgreSQL Database Deployment",hide_title:!1},sidebar:"docs",previous:{title:"Choosing and Configuration Your RDS Database",permalink:"/cumulus/docs/next/deployment/choosing_configuring_rds"},next:{title:"Component-based Cumulus Deployment",permalink:"/cumulus/docs/next/deployment/components"}},p={},d=[{value:"Overview",id:"overview",level:2},{value:"Requirements",id:"requirements",level:2},{value:"Needed Git Repositories",id:"needed-git-repositories",level:3},{value:"Assumptions",id:"assumptions",level:3},{value:"OS/Environment",id:"osenvironment",level:4},{value:"Terraform",id:"terraform",level:4},{value:"Aurora/RDS",id:"aurorards",level:4},{value:"Prepare Deployment Repository",id:"prepare-deployment-repository",level:2},{value:"Prepare AWS Configuration",id:"prepare-aws-configuration",level:2},{value:"Configure and Deploy the Module",id:"configure-and-deploy-the-module",level:3},{value:"Configuration Options",id:"configuration-options",level:4},{value:"Provision User and User Database",id:"provision-user-and-user-database",level:4},{value:"Initialize Terraform",id:"initialize-terraform",level:4},{value:"Deploy",id:"deploy",level:4},{value:"Next Steps",id:"next-steps",level:3}],m={toc:d},c="wrapper";function f(e){var t=e.components,a=(0,r.Z)(e,s);return(0,o.kt)(c,(0,n.Z)({},m,a,{components:t,mdxType:"MDXLayout"}),(0,o.kt)("h2",{id:"overview"},"Overview"),(0,o.kt)("p",null,"Cumulus deployments require an Aurora ",(0,o.kt)("a",{parentName:"p",href:"https://www.postgresql.org/"},"PostgreSQL 11")," compatible database to be provided as the primary data store for Cumulus with Elasticsearch for non-authoritative querying/state data for the API and other applications that require more complex queries. Note that Cumulus is tested with an Aurora Postgres database."),(0,o.kt)("p",null,"Users are ",(0,o.kt)("em",{parentName:"p"},"strongly")," encouraged to plan for and implement a database solution that scales to their use requirements, meets their security posture and maintenance needs and/or allows for multi-tenant cluster usage."),(0,o.kt)("p",null,"For some scenarios (such as single tenant, test deployments, infrequent ingest and the like) a properly\nconfigured ",(0,o.kt)("a",{parentName:"p",href:"https://aws.amazon.com/rds/aurora/serverless/"},"Aurora Serverless")," cluster\n",(0,o.kt)("em",{parentName:"p"},"may")," suffice."),(0,o.kt)("p",null,"To that end, Cumulus provides a terraform module\n",(0,o.kt)("a",{parentName:"p",href:"https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus-rds-tf"},(0,o.kt)("inlineCode",{parentName:"a"},"cumulus-rds-tf")),"\nthat will deploy an AWS RDS Aurora Serverless PostgreSQL 11 compatible ",(0,o.kt)("a",{parentName:"p",href:"https://aws.amazon.com/rds/aurora/postgresql-features/"},"database cluster"),", and optionally provision a single deployment database with credentialed secrets for use with Cumulus."),(0,o.kt)("p",null,"We have provided an example terraform deployment using this module in the ",(0,o.kt)("a",{parentName:"p",href:"https://github.com/nasa/cumulus-template-deploy/tree/master/rds-cluster-tf"},"Cumulus template-deploy repository")," on github."),(0,o.kt)("p",null,"Use of this example involves:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},"Creating/configuring a ",(0,o.kt)("a",{parentName:"li",href:"https://www.terraform.io"},"Terraform")," module directory"),(0,o.kt)("li",{parentName:"ul"},"Using ",(0,o.kt)("a",{parentName:"li",href:"https://www.terraform.io"},"Terraform")," to deploy resources to AWS")),(0,o.kt)("hr",null),(0,o.kt)("h2",{id:"requirements"},"Requirements"),(0,o.kt)("p",null,"Configuration/installation of this module requires the following:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"https://www.terraform.io"},"Terraform")),(0,o.kt)("li",{parentName:"ul"},"git"),(0,o.kt)("li",{parentName:"ul"},"A VPC configured for use with Cumulus Core.  This should match the subnets you provide when ",(0,o.kt)("a",{parentName:"li",href:"./"},"Deploying Cumulus")," to allow Core's lambdas to properly access the database."),(0,o.kt)("li",{parentName:"ul"},"At least two subnets across multiple AZs.  These should match the subnets you provide as configuration when ",(0,o.kt)("a",{parentName:"li",href:"./"},"Deploying Cumulus"),", and should be within the same VPC.")),(0,o.kt)("h3",{id:"needed-git-repositories"},"Needed Git Repositories"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"https://github.com/nasa/cumulus-template-deploy"},"Cumulus Deployment Template"))),(0,o.kt)("h3",{id:"assumptions"},"Assumptions"),(0,o.kt)("h4",{id:"osenvironment"},"OS/Environment"),(0,o.kt)("p",null,"The instructions in this module require Linux/MacOS.   While deployment via Windows is possible, it is unsupported."),(0,o.kt)("h4",{id:"terraform"},"Terraform"),(0,o.kt)("p",null,"This document assumes knowledge of Terraform. If you are not comfortable\nworking with Terraform, the following links should bring you up to speed:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"https://www.terraform.io/intro/index.html"},"Introduction to Terraform")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"https://learn.hashicorp.com/terraform/?track=getting-started#getting-started"},"Getting Started with Terraform and AWS")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"https://www.terraform.io/docs/configuration/index.html"},"Terraform Configuration Language"))),(0,o.kt)("p",null,"For Cumulus specific instructions on installation of Terraform, refer to the main ",(0,o.kt)("a",{parentName:"p",href:"https://nasa.github.io/cumulus/docs/deployment/#install-terraform"},"Cumulus Installation Documentation")),(0,o.kt)("h4",{id:"aurorards"},"Aurora/RDS"),(0,o.kt)("p",null,"This document also assumes some basic familiarity with PostgreSQL databases and Amazon Aurora/RDS.   If you're unfamiliar consider perusing the ",(0,o.kt)("a",{parentName:"p",href:"https://aws.amazon.com/rds/aurora/"},"AWS docs")," and the ",(0,o.kt)("a",{parentName:"p",href:"https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html"},"Aurora Serverless V1 docs"),"."),(0,o.kt)("h2",{id:"prepare-deployment-repository"},"Prepare Deployment Repository"),(0,o.kt)("blockquote",null,(0,o.kt)("p",{parentName:"blockquote"},"If you already are working with an existing repository that has a configured ",(0,o.kt)("inlineCode",{parentName:"p"},"rds-cluster-tf")," deployment for the version of Cumulus you intend to deploy or update, ",(0,o.kt)("em",{parentName:"p"},"or"),"  just need to configure this module for your repository, skip to ",(0,o.kt)("a",{parentName:"p",href:"postgres_database_deployment#prepare-aws-configuration"},"Prepare AWS Configuration."))),(0,o.kt)("p",null,"Clone the ",(0,o.kt)("a",{parentName:"p",href:"https://github.com/nasa/cumulus-template-deploy"},(0,o.kt)("inlineCode",{parentName:"a"},"cumulus-template-deploy"))," repo and name appropriately for your organization:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-bash"},"  git clone https://github.com/nasa/cumulus-template-deploy <repository-name>\n")),(0,o.kt)("p",null,"We will return to ",(0,o.kt)("a",{parentName:"p",href:"#configure-and-deploy-the-module"},"configuring this repo and using it for deployment below"),"."),(0,o.kt)("details",null,(0,o.kt)("summary",null,"Optional: Create a New Repository"),(0,o.kt)("p",null,"  ",(0,o.kt)("a",{parentName:"p",href:"https://help.github.com/articles/creating-a-new-repository/"},"Create a new repository")," on Github so that you can add your workflows and other modules to source control:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-bash"},"  git remote set-url origin https://github.com/<org>/<repository-name>\n  git push origin master\n")),(0,o.kt)("p",null,"You can then ",(0,o.kt)("a",{parentName:"p",href:"https://help.github.com/articles/adding-a-file-to-a-repository-using-the-command-line/"},"add/commit")," changes as needed."),(0,o.kt)("blockquote",null,(0,o.kt)("p",{parentName:"blockquote"},"\u26a0\ufe0f ",(0,o.kt)("strong",{parentName:"p"},"Note"),": If you are pushing your deployment code to a git repo, make sure to add ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform.tf")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform.tfvars")," to ",(0,o.kt)("inlineCode",{parentName:"p"},".gitignore"),", ",(0,o.kt)("strong",{parentName:"p"},"as these files will contain sensitive data related to your AWS account"),"."))),(0,o.kt)("hr",null),(0,o.kt)("h2",{id:"prepare-aws-configuration"},"Prepare AWS Configuration"),(0,o.kt)("p",null,"To deploy this module, you need to make sure that you have the following steps from the ",(0,o.kt)("a",{parentName:"p",href:"#prepare-aws-configuration"},"Cumulus deployment instructions")," in similar fashion ",(0,o.kt)("em",{parentName:"p"},"for this module"),":"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"#set-access-keys"},"Set Access Keys")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"#create-the-state-bucket"},"Create the state bucket")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("a",{parentName:"li",href:"#create-the-locks-table"},"Create the locks table"))),(0,o.kt)("p",null,"--"),(0,o.kt)("h3",{id:"configure-and-deploy-the-module"},"Configure and Deploy the Module"),(0,o.kt)("p",null,"When configuring this module, please keep in mind that unlike Cumulus deployment, ",(0,o.kt)("strong",{parentName:"p"},"this module should be deployed once")," to create the database cluster and only thereafter to make changes to that configuration/upgrade/etc."),(0,o.kt)("blockquote",null,(0,o.kt)("p",{parentName:"blockquote"},(0,o.kt)("strong",{parentName:"p"},"Tip"),": This module does not need to be re-deployed for each Core update.")),(0,o.kt)("p",null,"These steps should be executed in the ",(0,o.kt)("inlineCode",{parentName:"p"},"rds-cluster-tf")," directory of the template deploy repo that you previously cloned. Run the following to copy the example files:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-shell"},"cd rds-cluster-tf/\ncp terraform.tf.example terraform.tf\ncp terraform.tfvars.example terraform.tfvars\n")),(0,o.kt)("p",null,"In ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform.tf"),", configure the remote state settings by substituting the appropriate values for:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"bucket")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"dynamodb_table")),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"PREFIX")," (whatever prefix you've chosen for your deployment)")),(0,o.kt)("p",null,"Fill in the appropriate values in ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform.tfvars"),". See the ",(0,o.kt)("a",{parentName:"p",href:"https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus-rds-tf"},"rds-cluster-tf module variable definitions")," for more detail on all of the configuration options.  A few notable configuration options are documented in the next section."),(0,o.kt)("h4",{id:"configuration-options"},"Configuration Options"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"deletion_protection")," -- defaults to ",(0,o.kt)("inlineCode",{parentName:"li"},"true"),".   Set it to ",(0,o.kt)("inlineCode",{parentName:"li"},"false")," if you want to be able to delete your ",(0,o.kt)("em",{parentName:"li"},"cluster")," with a terraform destroy without manually updating the cluster."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"db_admin_username")," -- cluster database administration username.   Defaults to ",(0,o.kt)("inlineCode",{parentName:"li"},"postgres"),"."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"db_admin_password")," -- required variable that specifies the admin user password for the cluster.   To randomize this on each deployment, consider using a ",(0,o.kt)("a",{parentName:"li",href:"https://registry.terraform.io/providers/hashicorp/random/latest/docs/resources/string"},(0,o.kt)("inlineCode",{parentName:"a"},"random_string"))," resource as input."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"region")," -- defaults to ",(0,o.kt)("inlineCode",{parentName:"li"},"us-east-1"),"."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"subnets")," -- requires at least 2 across different AZs.   For use with Cumulus, these AZs should match the values you configure for your ",(0,o.kt)("inlineCode",{parentName:"li"},"lambda_subnet_ids"),"."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"max_capacity")," -- the max ACUs the cluster is allowed to use.    Carefully consider cost/performance concerns when setting this value."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"min_capacity")," -- the minimum ACUs the cluster will scale to"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"provision_user_database")," -- Optional flag to allow module to provision a user database in addition to creating the cluster.   Described in the ",(0,o.kt)("a",{parentName:"li",href:"#provision-user-and-user-database"},"next section"),".")),(0,o.kt)("h4",{id:"provision-user-and-user-database"},"Provision User and User Database"),(0,o.kt)("p",null,"If you wish for the module to provision a PostgreSQL database on your new cluster and provide a secret for access in the module output, ",(0,o.kt)("em",{parentName:"p"},"in addition to")," managing the cluster itself, the following configuration keys are required:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"provision_user_database")," -- must be set to ",(0,o.kt)("inlineCode",{parentName:"li"},"true"),". This configures the module to deploy a lambda that will create the user database, and update the provided configuration on deploy."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"permissions_boundary_arn")," -- the permissions boundary to use in creating the roles for access the provisioning lambda will need.  This should in most use cases be the same one used for Cumulus Core deployment."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"rds_user_password")," -- the value to set the user password to."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"prefix")," -- this value will be used to set a unique identifier for the ",(0,o.kt)("inlineCode",{parentName:"li"},"ProvisionDatabase")," lambda, as well as name the provisioned user/database.")),(0,o.kt)("p",null,"Once configured, the module will deploy the lambda and run it on each provision thus creating the configured database (if it does not exist), updating the user password (if that value has been changed), and updating the output user database secret."),(0,o.kt)("p",null,"Setting ",(0,o.kt)("inlineCode",{parentName:"p"},"provision_user_database")," to false after provisioning will ",(0,o.kt)("strong",{parentName:"p"},"not")," result in removal of the configured database, as the lambda is non-destructive as configured in this module."),(0,o.kt)("blockquote",null,(0,o.kt)("p",{parentName:"blockquote"},"\u26a0\ufe0f ",(0,o.kt)("strong",{parentName:"p"},"Note:")," This functionality is limited in that it will only provision a single database/user and configure a basic database, and should not be used in scenarios where more complex configuration is required.")),(0,o.kt)("h4",{id:"initialize-terraform"},"Initialize Terraform"),(0,o.kt)("p",null,"Run ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform init")),(0,o.kt)("p",null,"You should see a similar output:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-shell"},'* provider.aws: version = "~> 2.32"\n\nTerraform has been successfully initialized!\n')),(0,o.kt)("h4",{id:"deploy"},"Deploy"),(0,o.kt)("p",null,"Run ",(0,o.kt)("inlineCode",{parentName:"p"},"terraform apply")," to deploy the resources."),(0,o.kt)("blockquote",null,(0,o.kt)("p",{parentName:"blockquote"},"\u26a0\ufe0f ",(0,o.kt)("strong",{parentName:"p"},"Caution"),": If re-applying this module, variables (e.g. ",(0,o.kt)("inlineCode",{parentName:"p"},"engine_version"),", ",(0,o.kt)("inlineCode",{parentName:"p"},"snapshot_identifier")," ) that force a recreation of the database cluster may result in data loss if deletion protection is disabled.  Examine the changeset ",(0,o.kt)("strong",{parentName:"p"},"carefully")," for resources that will be re-created/destroyed before applying.")),(0,o.kt)("p",null,"Review the changeset, and assuming it looks correct, type ",(0,o.kt)("inlineCode",{parentName:"p"},"yes")," when prompted to confirm that you want to create all of the resources."),(0,o.kt)("p",null,"Assuming the operation is successful, you should see output similar to the following (this example omits the creation of a user database/lambdas/security groups):"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-shell"},'terraform apply\n\nAn execution plan has been generated and is shown below.\nResource actions are indicated with the following symbols:\n  + create\n\nTerraform will perform the following actions:\n\n  # module.rds_cluster.aws_db_subnet_group.default will be created\n  + resource "aws_db_subnet_group" "default" {\n      + arn         = (known after apply)\n      + description = "Managed by Terraform"\n      + id          = (known after apply)\n      + name        = (known after apply)\n      + name_prefix = "xxxxxxxxx"\n      + subnet_ids  = [\n          + "subnet-xxxxxxxxx",\n          + "subnet-xxxxxxxxx",\n        ]\n      + tags        = {\n          + "Deployment" = "xxxxxxxxx"\n        }\n    }\n\n  # module.rds_cluster.aws_rds_cluster.cumulus will be created\n  + resource "aws_rds_cluster" "cumulus" {\n      + apply_immediately               = true\n      + arn                             = (known after apply)\n      + availability_zones              = (known after apply)\n      + backup_retention_period         = 1\n      + cluster_identifier              = "xxxxxxxxx"\n      + cluster_identifier_prefix       = (known after apply)\n      + cluster_members                 = (known after apply)\n      + cluster_resource_id             = (known after apply)\n      + copy_tags_to_snapshot           = false\n      + database_name                   = "xxxxxxxxx"\n      + db_cluster_parameter_group_name = (known after apply)\n      + db_subnet_group_name            = (known after apply)\n      + deletion_protection             = true\n      + enable_http_endpoint            = true\n      + endpoint                        = (known after apply)\n      + engine                          = "aurora-postgresql"\n      + engine_mode                     = "serverless"\n      + engine_version                  = "10.12"\n      + final_snapshot_identifier       = "xxxxxxxxx"\n      + hosted_zone_id                  = (known after apply)\n      + id                              = (known after apply)\n      + kms_key_id                      = (known after apply)\n      + master_password                 = (sensitive value)\n      + master_username                 = "xxxxxxxxx"\n      + port                            = (known after apply)\n      + preferred_backup_window         = "07:00-09:00"\n      + preferred_maintenance_window    = (known after apply)\n      + reader_endpoint                 = (known after apply)\n      + skip_final_snapshot             = false\n      + storage_encrypted               = (known after apply)\n      + tags                            = {\n          + "Deployment" = "xxxxxxxxx"\n        }\n      + vpc_security_group_ids          = (known after apply)\n\n      + scaling_configuration {\n          + auto_pause               = true\n          + max_capacity             = 4\n          + min_capacity             = 2\n          + seconds_until_auto_pause = 300\n          + timeout_action           = "RollbackCapacityChange"\n        }\n    }\n\n  # module.rds_cluster.aws_secretsmanager_secret.rds_login will be created\n  + resource "aws_secretsmanager_secret" "rds_login" {\n      + arn                     = (known after apply)\n      + id                      = (known after apply)\n      + name                    = (known after apply)\n      + name_prefix             = "xxxxxxxxx"\n      + policy                  = (known after apply)\n      + recovery_window_in_days = 30\n      + rotation_enabled        = (known after apply)\n      + rotation_lambda_arn     = (known after apply)\n      + tags                    = {\n          + "Deployment" = "xxxxxxxxx"\n        }\n\n      + rotation_rules {\n          + automatically_after_days = (known after apply)\n        }\n    }\n\n  # module.rds_cluster.aws_secretsmanager_secret_version.rds_login will be created\n  + resource "aws_secretsmanager_secret_version" "rds_login" {\n      + arn            = (known after apply)\n      + id             = (known after apply)\n      + secret_id      = (known after apply)\n      + secret_string  = (sensitive value)\n      + version_id     = (known after apply)\n      + version_stages = (known after apply)\n    }\n\n  # module.rds_cluster.aws_security_group.rds_cluster_access will be created\n  + resource "aws_security_group" "rds_cluster_access" {\n      + arn                    = (known after apply)\n      + description            = "Managed by Terraform"\n      + egress                 = (known after apply)\n      + id                     = (known after apply)\n      + ingress                = (known after apply)\n      + name                   = (known after apply)\n      + name_prefix            = "cumulus_rds_cluster_access_ingress"\n      + owner_id               = (known after apply)\n      + revoke_rules_on_delete = false\n      + tags                   = {\n          + "Deployment" = "xxxxxxxxx"\n        }\n      + vpc_id                 = "vpc-xxxxxxxxx"\n    }\n\n  # module.rds_cluster.aws_security_group_rule.rds_security_group_allow_PostgreSQL will be created\n  + resource "aws_security_group_rule" "rds_security_group_allow_postgres" {\n      + from_port                = 5432\n      + id                       = (known after apply)\n      + protocol                 = "tcp"\n      + security_group_id        = (known after apply)\n      + self                     = true\n      + source_security_group_id = (known after apply)\n      + to_port                  = 5432\n      + type                     = "ingress"\n    }\n\nPlan: 6 to add, 0 to change, 0 to destroy.\n\nDo you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only \'yes\' will be accepted to approve.\n\n  Enter a value: yes\n\nmodule.rds_cluster.aws_db_subnet_group.default: Creating...\nmodule.rds_cluster.aws_security_group.rds_cluster_access: Creating...\nmodule.rds_cluster.aws_secretsmanager_secret.rds_login: Creating...\n')),(0,o.kt)("p",null,"Then, after the resources are created:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-shell"},"Apply complete! Resources: X added, 0 changed, 0 destroyed.\nReleasing state lock. This may take a few moments...\n\nOutputs:\n\nadmin_db_login_secret_arn = arn:aws:secretsmanager:us-east-1:xxxxxxxxx:secret:xxxxxxxxxx20210407182709367700000002-dpmdR\nadmin_db_login_secret_version = xxxxxxxxx\nrds_endpoint = xxxxxxxxx.us-east-1.rds.amazonaws.com\nsecurity_group_id = xxxxxxxxx\nuser_credentials_secret_arn = arn:aws:secretsmanager:us-east-1:xxxxx:secret:xxxxxxxxxx20210407182709367700000002-dpmpXA\n")),(0,o.kt)("p",null,"Note the output values for ",(0,o.kt)("inlineCode",{parentName:"p"},"admin_db_login_secret_arn")," (and optionally ",(0,o.kt)("inlineCode",{parentName:"p"},"user_credentials_secret_arn"),") as these provide the AWS Secrets Manager secrets required to access the database as the administrative user and, optionally, the user database credentials Cumulus requires as well."),(0,o.kt)("p",null,"The content of each of these secrets are in the form:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-json"},'{\n  "database": "postgres",\n  "dbClusterIdentifier": "clusterName",\n  "engine": "postgres",\n  "host": "xxx",\n  "password": "defaultPassword",\n  "port": 5432,\n  "username": "xxx"\n}\n')),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"database")," -- the PostgreSQL database used by the configured user"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"dbClusterIdentifier")," -- the value set by the  ",(0,o.kt)("inlineCode",{parentName:"li"},"cluster_identifier")," variable in the terraform module"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"engine")," -- the Aurora/RDS database engine"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"host")," -- the RDS service host for the database in the form (dbClusterIdentifier)-(AWS ID string).(region).rds.amazonaws.com"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"password")," -- the database password"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"username")," -- the account username"),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"port")," -- The database connection port, should always be 5432")),(0,o.kt)("h3",{id:"next-steps"},"Next Steps"),(0,o.kt)("p",null,"The database cluster has been created/updated! From here you can continue to add additional user accounts, databases, and other database configuration."))}f.isMDXComponent=!0}}]);