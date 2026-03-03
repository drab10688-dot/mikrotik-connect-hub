-- FreeRADIUS MySQL Schema + daloRADIUS extra tables

CREATE TABLE IF NOT EXISTS radcheck (
  id int(11) unsigned NOT NULL auto_increment,
  username varchar(64) NOT NULL default '',
  attribute varchar(64) NOT NULL default '',
  op char(2) NOT NULL DEFAULT '==',
  value varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY username (username(32))
);

CREATE TABLE IF NOT EXISTS radreply (
  id int(11) unsigned NOT NULL auto_increment,
  username varchar(64) NOT NULL default '',
  attribute varchar(64) NOT NULL default '',
  op char(2) NOT NULL DEFAULT '=',
  value varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY username (username(32))
);

CREATE TABLE IF NOT EXISTS radgroupcheck (
  id int(11) unsigned NOT NULL auto_increment,
  groupname varchar(64) NOT NULL default '',
  attribute varchar(64) NOT NULL default '',
  op char(2) NOT NULL DEFAULT '==',
  value varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY groupname (groupname(32))
);

CREATE TABLE IF NOT EXISTS radgroupreply (
  id int(11) unsigned NOT NULL auto_increment,
  groupname varchar(64) NOT NULL default '',
  attribute varchar(64) NOT NULL default '',
  op char(2) NOT NULL DEFAULT '=',
  value varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY groupname (groupname(32))
);

CREATE TABLE IF NOT EXISTS radusergroup (
  id int(11) unsigned NOT NULL auto_increment,
  username varchar(64) NOT NULL default '',
  groupname varchar(64) NOT NULL default '',
  priority int(11) NOT NULL default '1',
  PRIMARY KEY (id),
  KEY username (username(32))
);

CREATE TABLE IF NOT EXISTS radacct (
  radacctid bigint(21) NOT NULL auto_increment,
  acctsessionid varchar(64) NOT NULL default '',
  acctuniqueid varchar(32) NOT NULL default '',
  username varchar(64) NOT NULL default '',
  groupname varchar(64) NOT NULL default '',
  realm varchar(64) default '',
  nasipaddress varchar(15) NOT NULL default '',
  nasportid varchar(32) default NULL,
  nasporttype varchar(32) default NULL,
  acctstarttime datetime NULL default NULL,
  acctupdatetime datetime NULL default NULL,
  acctstoptime datetime NULL default NULL,
  acctinterval int(12) default NULL,
  acctsessiontime int(12) unsigned default NULL,
  acctauthentic varchar(32) default NULL,
  connectinfo_start varchar(50) default NULL,
  connectinfo_stop varchar(50) default NULL,
  acctinputoctets bigint(20) default NULL,
  acctoutputoctets bigint(20) default NULL,
  calledstationid varchar(50) NOT NULL default '',
  callingstationid varchar(50) NOT NULL default '',
  acctterminatecause varchar(32) NOT NULL default '',
  servicetype varchar(32) default NULL,
  framedprotocol varchar(32) default NULL,
  framedipaddress varchar(15) NOT NULL default '',
  framedipv6address varchar(45) NOT NULL default '',
  framedipv6prefix varchar(45) NOT NULL default '',
  framedinterfaceid varchar(44) NOT NULL default '',
  delegatedipv6prefix varchar(45) NOT NULL default '',
  class varchar(64) default NULL,
  PRIMARY KEY (radacctid),
  UNIQUE KEY acctuniqueid (acctuniqueid),
  KEY username (username),
  KEY framedipaddress (framedipaddress),
  KEY acctsessionid (acctsessionid),
  KEY acctsessiontime (acctsessiontime),
  KEY acctstarttime (acctstarttime),
  KEY acctinterval (acctinterval),
  KEY acctstoptime (acctstoptime),
  KEY nasipaddress (nasipaddress)
);

CREATE TABLE IF NOT EXISTS radpostauth (
  id int(11) NOT NULL auto_increment,
  username varchar(64) NOT NULL default '',
  pass varchar(64) NOT NULL default '',
  reply varchar(32) NOT NULL default '',
  authdate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  class varchar(64) default NULL,
  PRIMARY KEY (id),
  KEY username (username),
  KEY class (class)
);

CREATE TABLE IF NOT EXISTS nas (
  id int(10) NOT NULL auto_increment,
  nasname varchar(128) NOT NULL,
  shortname varchar(32),
  type varchar(30) DEFAULT 'other',
  ports int(5),
  secret varchar(60) DEFAULT 'secret' NOT NULL,
  server varchar(64),
  community varchar(50),
  description varchar(200) DEFAULT 'RADIUS Client',
  PRIMARY KEY (id),
  KEY nasname (nasname)
);

-- ============================================
-- daloRADIUS extra tables
-- ============================================

CREATE TABLE IF NOT EXISTS operators (
  id int(11) NOT NULL auto_increment,
  username varchar(32) NOT NULL default '',
  password varchar(32) NOT NULL default '',
  firstname varchar(32) default NULL,
  lastname varchar(32) default NULL,
  title varchar(32) default NULL,
  department varchar(32) default NULL,
  company varchar(32) default NULL,
  phone1 varchar(32) default NULL,
  phone2 varchar(32) default NULL,
  email1 varchar(64) default NULL,
  email2 varchar(64) default NULL,
  messenger1 varchar(64) default NULL,
  messenger2 varchar(64) default NULL,
  notes varchar(128) default NULL,
  lastlogin datetime default NULL,
  privilege varchar(64) default NULL,
  PRIMARY KEY (id)
);

-- Default operator: admin/radius
INSERT IGNORE INTO operators (id, username, password, firstname, lastname, privilege)
VALUES (1, 'administrator', 'radius', 'Administrator', '', 'full');

CREATE TABLE IF NOT EXISTS operators_acl (
  id int(11) NOT NULL auto_increment,
  operator_id int(11) NOT NULL,
  filename varchar(128) NOT NULL,
  access tinyint(1) NOT NULL default '1',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS operators_acl_files (
  id int(11) NOT NULL auto_increment,
  filename varchar(128) NOT NULL,
  title varchar(128) default NULL,
  section varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS userinfo (
  id int(11) NOT NULL auto_increment,
  username varchar(128) default NULL,
  firstname varchar(200) default NULL,
  lastname varchar(200) default NULL,
  email varchar(200) default NULL,
  department varchar(200) default NULL,
  company varchar(200) default NULL,
  workphone varchar(200) default NULL,
  homephone varchar(200) default NULL,
  mobilephone varchar(200) default NULL,
  address varchar(200) default NULL,
  city varchar(200) default NULL,
  state varchar(200) default NULL,
  country varchar(100) default NULL,
  zip varchar(200) default NULL,
  notes varchar(200) default NULL,
  changeuserinfo varchar(128) default NULL,
  portalloginpassword varchar(128) default '0',
  enableportallogin int(11) default '0',
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id),
  KEY username (username)
);

CREATE TABLE IF NOT EXISTS userbillinfo (
  id int(11) NOT NULL auto_increment,
  username varchar(128) default NULL,
  planName varchar(128) default NULL,
  contactperson varchar(200) default NULL,
  company varchar(200) default NULL,
  email varchar(200) default NULL,
  phone varchar(200) default NULL,
  address varchar(200) default NULL,
  city varchar(200) default NULL,
  state varchar(200) default NULL,
  country varchar(100) default NULL,
  zip varchar(200) default NULL,
  paymentmethod varchar(200) default NULL,
  cash varchar(200) default NULL,
  creditcardname varchar(200) default NULL,
  creditcardnumber varchar(200) default NULL,
  creditcardverification varchar(200) default NULL,
  creditcardtype varchar(200) default NULL,
  creditcardexp varchar(200) default NULL,
  notes varchar(200) default NULL,
  changeuserbillinfo varchar(128) default NULL,
  lead varchar(200) default NULL,
  coupon varchar(200) default NULL,
  ordertaker varchar(200) default NULL,
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id),
  KEY username (username)
);

CREATE TABLE IF NOT EXISTS hotspots (
  id int(11) NOT NULL auto_increment,
  name varchar(200) default NULL,
  mac varchar(200) default NULL,
  geocode varchar(200) default NULL,
  owner varchar(200) default NULL,
  email varchar(200) default NULL,
  manager varchar(200) default NULL,
  address varchar(200) default NULL,
  city varchar(200) default NULL,
  state varchar(200) default NULL,
  country varchar(100) default NULL,
  zip varchar(200) default NULL,
  phone1 varchar(200) default NULL,
  phone2 varchar(200) default NULL,
  type varchar(200) default NULL,
  status int(11) default NULL,
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS node (
  id int(11) NOT NULL auto_increment,
  hotspot_id int(11) NOT NULL,
  name varchar(200) default NULL,
  description varchar(200) default NULL,
  community varchar(200) default NULL,
  geocode varchar(200) default NULL,
  owner varchar(200) default NULL,
  status int(11) default NULL,
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS rates (
  id int(11) NOT NULL auto_increment,
  rateName varchar(128) default NULL,
  rateType varchar(128) default NULL,
  rateCost decimal(10,2) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS billing_plans (
  id int(11) NOT NULL auto_increment,
  planName varchar(128) NOT NULL default '',
  planId varchar(128) NOT NULL default '',
  planType varchar(128) NOT NULL default '',
  planTimeBank varchar(128) default NULL,
  planTimeType varchar(128) default NULL,
  planTimeRefillCost decimal(10,2) default NULL,
  planBandwidthUp int(11) default NULL,
  planBandwidthDown int(11) default NULL,
  planTrafficTotal bigint(20) default NULL,
  planTrafficUp bigint(20) default NULL,
  planTrafficDown bigint(20) default NULL,
  planTrafficRefillCost decimal(10,2) default NULL,
  planRecurring varchar(128) default NULL,
  planRecurringPeriod varchar(128) default NULL,
  planRecurringBillingSchedule varchar(128) default NULL,
  planCost decimal(10,2) default NULL,
  planSetupCost decimal(10,2) default NULL,
  planTax decimal(10,2) default NULL,
  planCurrency varchar(128) default NULL,
  planGroup varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS billing_rates (
  id int(11) NOT NULL auto_increment,
  rateName varchar(128) default NULL,
  rateType varchar(128) default NULL,
  rateCost decimal(10,2) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS billing_history (
  id int(11) NOT NULL auto_increment,
  username varchar(128) default NULL,
  planId varchar(128) default NULL,
  billAmount decimal(10,2) default NULL,
  billAction varchar(128) default NULL,
  billPerformer varchar(128) default NULL,
  billReason varchar(200) default NULL,
  paymentmethod varchar(200) default NULL,
  cash varchar(200) default NULL,
  creditcardname varchar(200) default NULL,
  creditcardnumber varchar(200) default NULL,
  creditcardverification varchar(200) default NULL,
  creditcardtype varchar(200) default NULL,
  creditcardexp varchar(200) default NULL,
  coupon varchar(200) default NULL,
  discount decimal(10,2) default NULL,
  notes varchar(200) default NULL,
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS billing_paypal (
  id int(11) NOT NULL auto_increment,
  username varchar(128) default NULL,
  password varchar(128) default NULL,
  mac varchar(200) default NULL,
  pin varchar(200) default NULL,
  txnId varchar(200) default NULL,
  txnType varchar(200) default NULL,
  txnStatus varchar(200) default NULL,
  planName varchar(200) default NULL,
  planId varchar(200) default NULL,
  quantity varchar(200) default NULL,
  receiver varchar(200) default NULL,
  payerid varchar(200) default NULL,
  payerstatus varchar(200) default NULL,
  firstname varchar(200) default NULL,
  lastname varchar(200) default NULL,
  street varchar(200) default NULL,
  city varchar(200) default NULL,
  state varchar(200) default NULL,
  country varchar(200) default NULL,
  zip varchar(200) default NULL,
  email varchar(200) default NULL,
  charset varchar(200) default NULL,
  paymentdate datetime default NULL,
  gross decimal(10,2) default NULL,
  fee decimal(10,2) default NULL,
  net decimal(10,2) default NULL,
  paymentstatus varchar(200) default NULL,
  paymenttype varchar(200) default NULL,
  currency varchar(200) default NULL,
  memo varchar(200) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS billing_merchant (
  id int(11) NOT NULL auto_increment,
  setting_name varchar(200) default NULL,
  setting_value varchar(200) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS dictionary (
  id int(10) NOT NULL auto_increment,
  Type varchar(30) default NULL,
  Attribute varchar(64) default NULL,
  Value varchar(64) default NULL,
  Format varchar(20) default NULL,
  Vendor varchar(32) default NULL,
  RecommendedOP varchar(32) default NULL,
  RecommendedTable varchar(32) default NULL,
  RecommendedHelper varchar(32) default NULL,
  RecommendedTooltip varchar(512) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS realms (
  id int(11) NOT NULL auto_increment,
  realmname varchar(128) NOT NULL default '',
  type varchar(32) NOT NULL default '',
  authhost varchar(256) NOT NULL default '',
  accthost varchar(256) NOT NULL default '',
  secret varchar(128) NOT NULL default '',
  ldflag varchar(64) NOT NULL default '',
  nostrip int(11) NOT NULL default '0',
  hints int(11) NOT NULL default '0',
  notrealm int(11) NOT NULL default '0',
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS proxys (
  id int(11) NOT NULL auto_increment,
  proxyname varchar(128) NOT NULL default '',
  retry_delay int(11) NOT NULL default '5',
  retry_count int(11) NOT NULL default '3',
  dead_time int(11) NOT NULL default '120',
  default_fallback int(11) NOT NULL default '0',
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS messages (
  id int(11) NOT NULL auto_increment,
  type varchar(32) NOT NULL default '',
  content text,
  modified_on datetime default NULL,
  modified_by varchar(128) default NULL,
  created_on datetime default NULL,
  created_by varchar(128) default NULL,
  PRIMARY KEY (id)
);

-- Default login message
INSERT IGNORE INTO messages (id, type, content, created_on, created_by)
VALUES (1, 'login', 'Welcome to daloRADIUS - OmniSync ISP Manager', NOW(), 'system');

CREATE TABLE IF NOT EXISTS batch_history (
  id int(11) NOT NULL auto_increment,
  batch_name varchar(64) NOT NULL,
  batch_description varchar(256) default NULL,
  hotspot_id int(11) default NULL,
  batch_status varchar(32) default NULL,
  creationdate datetime default NULL,
  creationby varchar(128) default NULL,
  updatedate datetime default NULL,
  updateby varchar(128) default NULL,
  PRIMARY KEY (id)
);
