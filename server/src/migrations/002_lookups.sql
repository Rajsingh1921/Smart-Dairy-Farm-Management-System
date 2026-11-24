-- Reference data only (no business figures). All values are editable in Settings.
-- Gestation days are commonly used averages; change them in Settings if your vet advises otherwise.
INSERT INTO species (code, name_en, name_mr, gestation_days) VALUES
  ('cow', 'Cow', 'गाय', 283),
  ('buffalo', 'Buffalo', 'म्हैस', 310);

INSERT INTO breeds (species_id, name)
SELECT s.id, b.name FROM species s
JOIN (SELECT 'cow' code, 'Jersey' name UNION ALL SELECT 'cow','HF (Holstein Friesian)'
      UNION ALL SELECT 'cow','Jersey Cross' UNION ALL SELECT 'cow','HF Cross'
      UNION ALL SELECT 'cow','Gir' UNION ALL SELECT 'cow','Sahiwal'
      UNION ALL SELECT 'cow','Deoni' UNION ALL SELECT 'cow','Red Kandhari'
      UNION ALL SELECT 'cow','Khillar' UNION ALL SELECT 'cow','Local / Non-descript'
      UNION ALL SELECT 'buffalo','Murrah' UNION ALL SELECT 'buffalo','Pandharpuri'
      UNION ALL SELECT 'buffalo','Jaffarabadi' UNION ALL SELECT 'buffalo','Mehsana'
      UNION ALL SELECT 'buffalo','Nagpuri' UNION ALL SELECT 'buffalo','Surti'
      UNION ALL SELECT 'buffalo','Local / Non-descript') b ON b.code = s.code;

INSERT INTO animal_categories (code, name_en, name_mr, is_milking, sort_order) VALUES
  ('milking', 'Milking', 'दुभती', 1, 1),
  ('dry', 'Dry / Non-milking', 'भाकड (दूध न देणारी)', 0, 2),
  ('heifer', 'Heifer', 'कालवड', 0, 3),
  ('calf', 'Calf', 'वासरू', 0, 4),
  ('bull', 'Bull', 'वळू', 0, 5),
  ('other', 'Other', 'इतर', 0, 6);

INSERT INTO expense_categories (code, name_en, name_mr, is_system) VALUES
  ('feed', 'Feed & fodder', 'चारा व खाद्य', 1),
  ('medicine_vet', 'Medicine & veterinary', 'औषध व पशुवैद्यकीय', 1),
  ('breeding', 'Breeding / AI', 'प्रजनन / कृत्रिम रेतन', 1),
  ('wages', 'Wages & salaries', 'पगार व मजुरी', 1),
  ('electricity', 'Electricity', 'वीज', 1),
  ('transport', 'Transport', 'वाहतूक', 1),
  ('equipment', 'Equipment', 'उपकरणे', 1),
  ('animal_purchase', 'Animal purchase', 'जनावर खरेदी', 1),
  ('maintenance', 'Repairs & maintenance', 'दुरुस्ती व देखभाल', 0),
  ('other', 'Other', 'इतर', 1);

INSERT INTO settings (setting_key, setting_value) VALUES
  ('farm_name', 'Smart Dairy Farm'),
  ('farm_address', ''),
  ('farm_phone', ''),
  ('invoice_footer', ''),
  ('payment_terms_days', '7'),
  ('pd_check_days', '60'),
  ('calving_alert_days', '30'),
  ('reminder_window_days', '7'),
  ('demo_mode', '0');

INSERT INTO counters (name, next_value) VALUES ('invoice', 1), ('receipt', 1);
