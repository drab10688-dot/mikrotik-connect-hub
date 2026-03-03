/**
 * NuxBill MariaDB client - Connects to PHPNuxBill database
 * for voucher and customer authentication.
 */
import mysql from 'mysql2/promise';
import crypto from 'crypto';

let nuxbillPool: mysql.Pool | null = null;

export function getNuxbillPool(): mysql.Pool {
  if (!nuxbillPool) {
    nuxbillPool = mysql.createPool({
      host: process.env.NUXBILL_DB_HOST || 'mariadb',
      port: parseInt(process.env.NUXBILL_DB_PORT || '3306'),
      user: process.env.NUXBILL_DB_USER || 'nuxbill',
      password: process.env.NUXBILL_DB_PASS || 'changeme_nuxbill',
      database: process.env.NUXBILL_DB_NAME || 'phpnuxbill',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return nuxbillPool;
}

/** SHA1 hash matching NuxBill's password format */
function sha1(str: string): string {
  return crypto.createHash('sha1').update(str).digest('hex');
}

/** MD5 hash for NuxBill's alternative password format */
function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

export interface NuxbillVoucher {
  id: number;
  type: string;
  routers: string;
  id_plan: number;
  code: string;
  user: string;
  status: string;
  created_at: string;
  used_date: string | null;
}

export interface NuxbillPlan {
  id: number;
  name_plan: string;
  id_bw: number;
  price: string;
  type: string;
  typebp: string;
  limit_type: string;
  time_limit: number;
  data_limit: number;
  validity: number;
  validity_unit: string;
  routers: string;
  pool: string;
  enabled: string;
}

export interface NuxbillCustomer {
  id: number;
  username: string;
  password: string;
  fullname: string;
  email: string;
  phonenumber: string;
  status: string;
}

export interface NuxbillRouter {
  id: number;
  name: string;
  ip_address: string;
  community: string;
  description: string;
  enabled: number;
}

/**
 * Validate a voucher code. Returns voucher + plan if valid.
 */
export async function validateVoucher(code: string): Promise<{
  voucher: NuxbillVoucher;
  plan: NuxbillPlan;
  router: NuxbillRouter;
} | null> {
  const pool = getNuxbillPool();
  
  const [vouchers] = await pool.query<any[]>(
    'SELECT * FROM tbl_voucher WHERE code = ? AND status = 0 LIMIT 1',
    [code]
  );
  
  if (!vouchers || vouchers.length === 0) return null;
  const voucher = vouchers[0] as NuxbillVoucher;
  
  // Get plan
  const [plans] = await pool.query<any[]>(
    'SELECT * FROM tbl_plans WHERE id = ? LIMIT 1',
    [voucher.id_plan]
  );
  if (!plans || plans.length === 0) return null;
  const plan = plans[0] as NuxbillPlan;
  
  // Get router
  const [routers] = await pool.query<any[]>(
    'SELECT * FROM tbl_routers WHERE name = ? LIMIT 1',
    [voucher.routers]
  );
  if (!routers || routers.length === 0) return null;
  const router = routers[0] as NuxbillRouter;
  
  return { voucher, plan, router };
}

/**
 * Activate a voucher: create customer, update voucher status
 */
export async function activateVoucher(
  voucherId: number,
  code: string,
  plan: NuxbillPlan,
  routerName: string
): Promise<{ username: string; password: string }> {
  const pool = getNuxbillPool();
  const conn = await pool.getConnection();
  
  try {
    await conn.beginTransaction();
    
    // Generate a password (same as voucher code for simplicity)
    const password = code;
    const username = code;
    
    // Calculate expiry based on plan validity
    const validityUnit = plan.validity_unit || 'Hrs';
    let expiryHours = plan.validity || 1;
    if (validityUnit === 'Days') expiryHours *= 24;
    else if (validityUnit === 'Months') expiryHours *= 24 * 30;
    
    const expDate = new Date();
    expDate.setHours(expDate.getHours() + expiryHours);
    const expDateStr = expDate.toISOString().slice(0, 19).replace('T', ' ');
    
    // Check if customer already exists
    const [existing] = await conn.query<any[]>(
      'SELECT id FROM tbl_customers WHERE username = ? LIMIT 1',
      [username]
    );
    
    if (!existing || existing.length === 0) {
      // Create customer in NuxBill
      await conn.query(
        `INSERT INTO tbl_customers (username, password, fullname, email, phonenumber, address, 
         service_type, auto_renewal, status, created_at, last_login)
         VALUES (?, ?, 'Voucher User', '', '', '', 'Hotspot', 0, 'Active', NOW(), NOW())`,
        [username, password]
      );
    }
    
    // Create user plan
    await conn.query(
      `INSERT INTO tbl_user_recharges (customer_id, username, plan_id, namebp, recharged_on, 
       recharged_time, expiration, time, status, method, routers, type)
       SELECT id, ?, ?, ?, NOW(), NOW(), ?, ?, 'on', 'voucher', ?, ?
       FROM tbl_customers WHERE username = ? LIMIT 1`,
      [username, plan.id, plan.name_plan, expDateStr, 
       plan.time_limit || 0, routerName, plan.type || 'Hotspot', username]
    );
    
    // Update voucher status
    await conn.query(
      'UPDATE tbl_voucher SET status = 1, user = ?, used_date = NOW() WHERE id = ?',
      [username, voucherId]
    );
    
    await conn.commit();
    return { username, password };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Validate customer login (username/password)
 */
export async function validateCustomer(
  username: string,
  password: string
): Promise<NuxbillCustomer | null> {
  const pool = getNuxbillPool();
  
  // NuxBill stores passwords in different formats depending on version
  // Try plain text first, then SHA1, then MD5
  const [customers] = await pool.query<any[]>(
    `SELECT * FROM tbl_customers 
     WHERE username = ? AND (password = ? OR password = ? OR password = ?)
     AND status = 'Active' LIMIT 1`,
    [username, password, sha1(password), md5(password)]
  );
  
  if (!customers || customers.length === 0) return null;
  return customers[0] as NuxbillCustomer;
}

/**
 * Get active recharge/plan for a customer
 */
export async function getCustomerActivePlan(username: string): Promise<any | null> {
  const pool = getNuxbillPool();
  
  const [plans] = await pool.query<any[]>(
    `SELECT ur.*, p.name_plan, p.type as plan_type
     FROM tbl_user_recharges ur
     LEFT JOIN tbl_plans p ON ur.plan_id = p.id
     WHERE ur.username = ? AND ur.status = 'on' 
     ORDER BY ur.id DESC LIMIT 1`,
    [username]
  );
  
  if (!plans || plans.length === 0) return null;
  return plans[0];
}
