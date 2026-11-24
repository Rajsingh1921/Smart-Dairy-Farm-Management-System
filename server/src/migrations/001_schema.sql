-- Smart Dairy Farm Manager: core schema (MySQL 8+, InnoDB, utf8mb4)
-- Money: DECIMAL(12,2) INR. Milk: litres DECIMAL. Business dates use DATE (Asia/Kolkata).

-- ---------------------------------------------------------------- users & settings
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner','manager','accountant','staff') NOT NULL,
  language ENUM('en','mr') NOT NULL DEFAULT 'en',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  failed_logins INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE counters (
  name VARCHAR(40) PRIMARY KEY,
  next_value INT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(30) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  entity_id VARCHAR(40) NULL,
  details JSON NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- configurable lookups
CREATE TABLE species (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name_en VARCHAR(60) NOT NULL,
  name_mr VARCHAR(60) NOT NULL,
  gestation_days SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_species_code (code)
) ENGINE=InnoDB;

CREATE TABLE breeds (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  species_id INT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_breed (species_id, name),
  CONSTRAINT fk_breed_species FOREIGN KEY (species_id) REFERENCES species(id)
) ENGINE=InnoDB;

CREATE TABLE animal_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name_en VARCHAR(60) NOT NULL,
  name_mr VARCHAR(60) NOT NULL,
  is_milking TINYINT(1) NOT NULL DEFAULT 0,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_category_code (code)
) ENGINE=InnoDB;

CREATE TABLE expense_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name_en VARCHAR(60) NOT NULL,
  name_mr VARCHAR(60) NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_expcat_code (code)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- finance core
CREATE TABLE suppliers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(15) NULL,
  address VARCHAR(255) NULL,
  supplies VARCHAR(255) NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_supplier_name (name)
) ENGINE=InnoDB;

-- Every cost the farm pays lives in exactly ONE row here. Feed purchases, vet bills,
-- salaries and animal purchases create linked rows (source_module) so profit never
-- double counts. Feed *usage* is not an expense (the purchase already was).
CREATE TABLE expenses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_date DATE NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NULL,
  payment_method ENUM('cash','upi','bank_transfer','cheque','credit','other') NOT NULL DEFAULT 'cash',
  paid_to VARCHAR(120) NULL,
  supplier_id INT UNSIGNED NULL,
  source_module ENUM('manual','inventory','health','breeding','salary','animal') NOT NULL DEFAULT 'manual',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_expense_date (expense_date),
  KEY ix_expense_cat_date (category_id, expense_date),
  CONSTRAINT chk_expense_amount CHECK (amount > 0),
  CONSTRAINT fk_expense_cat FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_expense_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_expense_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- animals
CREATE TABLE animals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag_no VARCHAR(30) NOT NULL,
  name VARCHAR(60) NULL,
  species_id INT UNSIGNED NOT NULL,
  breed_id INT UNSIGNED NULL,
  category_id INT UNSIGNED NOT NULL,
  sex ENUM('female','male') NOT NULL DEFAULT 'female',
  date_of_birth DATE NULL,
  dob_estimated TINYINT(1) NOT NULL DEFAULT 0,
  mother_id INT UNSIGNED NULL,
  sire_details VARCHAR(120) NULL,
  source ENUM('born_on_farm','purchased','other') NOT NULL DEFAULT 'purchased',
  purchase_date DATE NULL,
  purchase_price DECIMAL(12,2) NULL,
  purchased_from VARCHAR(120) NULL,
  purchase_expense_id INT UNSIGNED NULL,
  life_status ENUM('active','sold','dead','transferred') NOT NULL DEFAULT 'active',
  pregnancy_status ENUM('not_applicable','open','inseminated','pregnant') NOT NULL DEFAULT 'open',
  expected_calving_date DATE NULL,
  lactation_number TINYINT UNSIGNED NOT NULL DEFAULT 0,
  color_marks VARCHAR(120) NULL,
  photo_file VARCHAR(100) NULL,
  exit_date DATE NULL,
  exit_reason VARCHAR(255) NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_animal_tag (tag_no),
  KEY ix_animal_status_cat (life_status, category_id),
  KEY ix_animal_species (species_id),
  KEY ix_animal_mother (mother_id),
  KEY ix_animal_preg (pregnancy_status),
  CONSTRAINT chk_purchase_price CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT fk_animal_species FOREIGN KEY (species_id) REFERENCES species(id),
  CONSTRAINT fk_animal_breed FOREIGN KEY (breed_id) REFERENCES breeds(id) ON DELETE SET NULL,
  CONSTRAINT fk_animal_category FOREIGN KEY (category_id) REFERENCES animal_categories(id),
  CONSTRAINT fk_animal_mother FOREIGN KEY (mother_id) REFERENCES animals(id) ON DELETE SET NULL,
  CONSTRAINT fk_animal_expense FOREIGN KEY (purchase_expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_animal_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Every change of category / life status / pregnancy status is kept here.
CREATE TABLE animal_history (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id INT UNSIGNED NOT NULL,
  field_name VARCHAR(40) NOT NULL,
  old_value VARCHAR(255) NULL,
  new_value VARCHAR(255) NULL,
  event_date DATE NOT NULL,
  note VARCHAR(255) NULL,
  changed_by INT UNSIGNED NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ah_animal (animal_id, event_date),
  CONSTRAINT fk_ah_animal FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
  CONSTRAINT fk_ah_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Income other than milk sales (milk sales come from milk_deliveries only).
CREATE TABLE other_income (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  income_date DATE NOT NULL,
  category ENUM('animal_sale','manure_sale','subsidy','insurance_claim','other') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NULL,
  received_from VARCHAR(120) NULL,
  payment_method ENUM('cash','upi','bank_transfer','cheque','other') NOT NULL DEFAULT 'cash',
  animal_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_income_date (income_date),
  CONSTRAINT chk_income_amount CHECK (amount > 0),
  CONSTRAINT fk_income_animal FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE SET NULL,
  CONSTRAINT fk_income_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- milk production
CREATE TABLE milk_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id INT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  session ENUM('morning','evening') NOT NULL,
  quantity_litres DECIMAL(6,2) NOT NULL,
  fat_pct DECIMAL(4,2) NULL,
  snf_pct DECIMAL(4,2) NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_milk (animal_id, record_date, session),
  KEY ix_milk_date (record_date),
  CONSTRAINT chk_milk_qty CHECK (quantity_litres >= 0 AND quantity_litres <= 60),
  CONSTRAINT fk_milk_animal FOREIGN KEY (animal_id) REFERENCES animals(id),
  CONSTRAINT fk_milk_cuser FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_milk_uuser FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Edit history: kept even after a record is deleted (no FK to milk_records on purpose).
CREATE TABLE milk_record_history (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  milk_record_id INT UNSIGNED NOT NULL,
  animal_id INT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  session ENUM('morning','evening') NOT NULL,
  action ENUM('update','delete') NOT NULL,
  old_quantity DECIMAL(6,2) NULL,
  new_quantity DECIMAL(6,2) NULL,
  old_fat DECIMAL(4,2) NULL,
  new_fat DECIMAL(4,2) NULL,
  reason VARCHAR(255) NULL,
  changed_by INT UNSIGNED NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_mrh_record (milk_record_id),
  KEY ix_mrh_date (record_date),
  CONSTRAINT fk_mrh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Milk not sold: household use, calf feeding, wastage.
CREATE TABLE milk_usage (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usage_date DATE NOT NULL,
  usage_type ENUM('household','calf_feeding','wastage','other') NOT NULL,
  quantity_litres DECIMAL(8,2) NOT NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_usage_date (usage_date),
  CONSTRAINT chk_usage_qty CHECK (quantity_litres > 0),
  CONSTRAINT fk_usage_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- customers & sales
CREATE TABLE customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(15) NULL,
  address VARCHAR(255) NULL,
  village VARCHAR(80) NULL,
  customer_type ENUM('household','dairy_center','hotel','shop','other') NOT NULL DEFAULT 'household',
  default_rate DECIMAL(8,2) NOT NULL DEFAULT 0,
  default_qty_morning DECIMAL(6,2) NULL,
  default_qty_evening DECIMAL(6,2) NULL,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_customer_name (name),
  KEY ix_customer_phone (phone),
  CONSTRAINT chk_customer_rate CHECK (default_rate >= 0)
) ENGINE=InnoDB;

CREATE TABLE invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(30) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  invoice_date DATE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  due_date DATE NOT NULL,
  total_litres DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_no (invoice_no),
  KEY ix_invoice_customer (customer_id, invoice_date),
  CONSTRAINT fk_invoice_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_invoice_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- A delivery is a sale. Its amount is computed by the database from qty x rate.
CREATE TABLE milk_deliveries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  delivery_date DATE NOT NULL,
  session ENUM('morning','evening') NOT NULL,
  quantity_litres DECIMAL(8,2) NOT NULL,
  rate DECIMAL(8,2) NOT NULL,
  amount DECIMAL(12,2) AS (ROUND(quantity_litres * rate, 2)) STORED,
  invoice_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_delivery (customer_id, delivery_date, session),
  KEY ix_delivery_date (delivery_date),
  KEY ix_delivery_invoice (invoice_id),
  CONSTRAINT chk_delivery_qty CHECK (quantity_litres > 0),
  CONSTRAINT chk_delivery_rate CHECK (rate >= 0),
  CONSTRAINT fk_delivery_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_delivery_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_delivery_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Customer payments settle the balance (opening balance first, then invoices oldest-first).
CREATE TABLE payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(30) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('cash','upi','bank_transfer','cheque','other') NOT NULL DEFAULT 'cash',
  reference VARCHAR(60) NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_receipt_no (receipt_no),
  KEY ix_payment_customer (customer_id, payment_date),
  KEY ix_payment_date (payment_date),
  CONSTRAINT chk_payment_amount CHECK (amount > 0),
  CONSTRAINT fk_payment_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_payment_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- feed & inventory
CREATE TABLE inventory_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category ENUM('green_fodder','dry_fodder','concentrate','mineral','medicine','supplement','other') NOT NULL,
  unit ENUM('kg','litre','bag','piece','dose','bundle') NOT NULL DEFAULT 'kg',
  reorder_level DECIMAL(12,3) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_item_name (name)
) ENGINE=InnoDB;

-- Stock = SUM(quantity). Purchases/opening are positive, usage negative, adjustments either.
CREATE TABLE inventory_transactions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  txn_date DATE NOT NULL,
  txn_type ENUM('opening','purchase','usage','adjustment') NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(10,2) NULL,
  total_cost DECIMAL(12,2) NULL,
  supplier_id INT UNSIGNED NULL,
  expense_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_inv_item_date (item_id, txn_date),
  KEY ix_inv_date (txn_date),
  CONSTRAINT fk_inv_item FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  CONSTRAINT fk_inv_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- health
-- Diagnosis/medicines are entered by the farmer from the veterinarian's notes.
-- The system never suggests a diagnosis or treatment.
CREATE TABLE health_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id INT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  record_type ENUM('vet_visit','vaccination','deworming','treatment','checkup','other') NOT NULL,
  symptoms TEXT NULL,
  diagnosis TEXT NULL,
  vet_name VARCHAR(100) NULL,
  medicines TEXT NULL,
  vaccine_name VARCHAR(100) NULL,
  next_due_date DATE NULL,
  due_completed TINYINT(1) NOT NULL DEFAULT 0,
  follow_up_date DATE NULL,
  follow_up_done TINYINT(1) NOT NULL DEFAULT 0,
  cost DECIMAL(12,2) NULL,
  expense_id INT UNSIGNED NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_health_animal (animal_id, record_date),
  KEY ix_health_date (record_date),
  KEY ix_health_followup (follow_up_done, follow_up_date),
  KEY ix_health_due (due_completed, next_due_date),
  CONSTRAINT chk_health_cost CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT fk_health_animal FOREIGN KEY (animal_id) REFERENCES animals(id),
  CONSTRAINT fk_health_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_health_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- breeding
CREATE TABLE breeding_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id INT UNSIGNED NOT NULL,
  event_date DATE NOT NULL,
  event_type ENUM('heat','insemination','pregnancy_check','calving','abortion') NOT NULL,
  heat_signs VARCHAR(255) NULL,
  method ENUM('ai','natural') NULL,
  bull_or_semen VARCHAR(120) NULL,
  technician VARCHAR(100) NULL,
  pd_result ENUM('positive','negative','inconclusive') NULL,
  expected_calving_date DATE NULL,
  calving_outcome ENUM('live','stillborn') NULL,
  calf_id INT UNSIGNED NULL,
  insemination_id INT UNSIGNED NULL,
  cost DECIMAL(12,2) NULL,
  expense_id INT UNSIGNED NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_breed_animal (animal_id, event_date),
  KEY ix_breed_type_date (event_type, event_date),
  CONSTRAINT chk_breed_cost CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT fk_breed_animal FOREIGN KEY (animal_id) REFERENCES animals(id),
  CONSTRAINT fk_breed_calf FOREIGN KEY (calf_id) REFERENCES animals(id) ON DELETE SET NULL,
  CONSTRAINT fk_breed_ins FOREIGN KEY (insemination_id) REFERENCES breeding_events(id) ON DELETE SET NULL,
  CONSTRAINT fk_breed_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_breed_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- employees & tasks
CREATE TABLE employees (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NULL,
  role_title VARCHAR(60) NOT NULL,
  monthly_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
  join_date DATE NULL,
  leave_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  user_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_user (user_id),
  CONSTRAINT chk_emp_salary CHECK (monthly_salary >= 0),
  CONSTRAINT fk_employee_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE salary_payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  payment_date DATE NOT NULL,
  salary_month CHAR(7) NOT NULL,
  payment_type ENUM('salary','advance','bonus') NOT NULL DEFAULT 'salary',
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('cash','upi','bank_transfer','cheque','other') NOT NULL DEFAULT 'cash',
  expense_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_salary_emp (employee_id, salary_month),
  CONSTRAINT chk_salary_amount CHECK (amount > 0),
  CONSTRAINT fk_salary_emp FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_salary_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_salary_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NULL,
  assigned_to INT UNSIGNED NULL,
  animal_id INT UNSIGNED NULL,
  due_date DATE NULL,
  priority ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  status ENUM('pending','in_progress','done','cancelled') NOT NULL DEFAULT 'pending',
  completed_at DATETIME NULL,
  completed_by INT UNSIGNED NULL,
  completion_note VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_task_status_due (status, due_date),
  KEY ix_task_assignee (assigned_to, status),
  CONSTRAINT fk_task_emp FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_animal FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_cuser FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Manual reminders (automatic ones are computed live from the records above).
CREATE TABLE reminders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  due_date DATE NOT NULL,
  notes VARCHAR(255) NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_reminder_due (is_done, due_date),
  CONSTRAINT fk_reminder_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
