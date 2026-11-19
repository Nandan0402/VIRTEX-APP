-- Migration 015: Gym Equipment & Inventory Management
-- Manages equipment registry, condition monitoring, service schedules & history,
-- supplement & merchandise retail stock, suppliers, purchase orders, and low-stock alerts.

CREATE TABLE IF NOT EXISTS equipment_suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(100),
  category VARCHAR(50) DEFAULT 'Gym Equipment', -- 'Gym Equipment', 'Supplements', 'Apparel & Merchandise', 'Maintenance Services'
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gym_equipment (
  id SERIAL PRIMARY KEY,
  asset_tag VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'Free Weights', 'Selectorized Machines', 'Plate-Loaded', 'Cardio Machines', 'Cable Systems', 'Functional / Rig', 'Recovery & Wellness'
  brand VARCHAR(100),
  model_number VARCHAR(100),
  serial_number VARCHAR(100),
  floor_zone VARCHAR(100) DEFAULT 'Main Arena', -- 'Main Arena', 'Cardio Loft', 'Free Weight Zone', 'Functional Turf', 'Recovery Suite'
  purchase_date DATE,
  purchase_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  warranty_until DATE,
  condition_status VARCHAR(30) NOT NULL DEFAULT 'operational', -- 'operational', 'good', 'maintenance_needed', 'out_of_service'
  maintenance_interval_days INTEGER NOT NULL DEFAULT 30,
  last_serviced_date DATE,
  next_service_due DATE,
  supplier_id INTEGER REFERENCES equipment_suppliers(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_equipment_condition ON gym_equipment(condition_status);
CREATE INDEX IF NOT EXISTS idx_gym_equipment_category ON gym_equipment(category);

CREATE TABLE IF NOT EXISTS equipment_service_logs (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES gym_equipment(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_type VARCHAR(50) NOT NULL, -- 'Preventive Maintenance', 'Emergency Repair', 'Cable Replacement', 'Belt Calibration', 'Deep Sanitization'
  technician_name VARCHAR(100) NOT NULL,
  vendor_name VARCHAR(100),
  cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  parts_replaced TEXT,
  work_summary TEXT NOT NULL,
  condition_after VARCHAR(30) NOT NULL DEFAULT 'operational',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eq_service_date ON equipment_service_logs(service_date);

CREATE TABLE IF NOT EXISTS retail_inventory (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'Supplements', 'Merchandise & Apparel', 'Gym Accessories', 'Beverages & Snacks'
  brand VARCHAR(100),
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  cost_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_threshold INTEGER NOT NULL DEFAULT 5,
  unit_measure VARCHAR(20) DEFAULT 'Units',
  expiry_date DATE,
  supplier_id INTEGER REFERENCES equipment_suppliers(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_stock', -- 'in_stock', 'low_stock', 'out_of_stock'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_retail_inv_category ON retail_inventory(category);
CREATE INDEX IF NOT EXISTS idx_retail_inv_status ON retail_inventory(status);

CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
  id SERIAL PRIMARY KEY,
  po_code VARCHAR(50) UNIQUE NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES equipment_suppliers(id) ON DELETE CASCADE,
  order_date DATE NOT NULL,
  expected_delivery DATE,
  total_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(20) NOT NULL DEFAULT 'ordered', -- 'draft', 'ordered', 'received', 'cancelled'
  items_summary JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed Initial Data
DO $$
DECLARE
  v_sup_titan INTEGER;
  v_sup_nutrition INTEGER;
  v_sup_apparel INTEGER;
  v_eq_cable INTEGER;
  v_eq_squat INTEGER;
  v_eq_treadmill INTEGER;
  v_eq_dumbbells INTEGER;
BEGIN
  -- 1. Seed Suppliers
  INSERT INTO equipment_suppliers (name, contact_person, phone, email, category, address)
  VALUES ('Titan Gym Technology & Equipment Co.', 'Rajesh Khanna', '+91 98111 22334', 'orders@titangymtech.in', 'Gym Equipment', 'Plot 44, Peenya Industrial Area, Phase II, Bengaluru')
  RETURNING id INTO v_sup_titan;

  INSERT INTO equipment_suppliers (name, contact_person, phone, email, category, address)
  VALUES ('Optimum Sports Nutrition Distribution', 'Ananya Sen', '+91 98222 33445', 'sales@optimumdist.in', 'Supplements', 'Warehouse 12, Whitefield Logistics Park, Bengaluru')
  RETURNING id INTO v_sup_nutrition;

  INSERT INTO equipment_suppliers (name, contact_person, phone, email, category, address)
  VALUES ('PulseAthletics Apparel & Gear Co.', 'Vikram Seth', '+91 98333 44556', 'corporate@pulsegear.in', 'Apparel & Merchandise', 'Koramangala 4th Block, Bengaluru')
  RETURNING id INTO v_sup_apparel;

  -- 2. Seed Gym Equipment Registry
  INSERT INTO gym_equipment (
    asset_tag, name, category, brand, model_number, serial_number, floor_zone,
    purchase_date, purchase_cost, warranty_until, condition_status, maintenance_interval_days,
    last_serviced_date, next_service_due, supplier_id, notes
  )
  VALUES 
    (
      'PC-EQ-001', 'Dual Adjustable Pulley Cable Crossover Station', 'Cable Systems',
      'Titan Commercial', 'DAP-9000X', 'SN-TC-88912', 'Main Arena',
      CURRENT_DATE - INTERVAL '180 days', 185000.00, CURRENT_DATE + INTERVAL '540 days',
      'operational', 30, CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE + INTERVAL '18 days',
      v_sup_titan, 'Heavy-duty aircraft grade cables, bilateral swivel pulleys.'
    )
    RETURNING id INTO v_eq_cable;

  INSERT INTO gym_equipment (
    asset_tag, name, category, brand, model_number, serial_number, floor_zone,
    purchase_date, purchase_cost, warranty_until, condition_status, maintenance_interval_days,
    last_serviced_date, next_service_due, supplier_id, notes
  )
  VALUES 
    (
      'PC-EQ-002', 'Commercial Power Rack & Olympic Lifting Platform', 'Free Weights',
      'Eleiko Olympic', 'PWR-RACK-PRO', 'SN-EL-33419', 'Free Weight Zone',
      CURRENT_DATE - INTERVAL '240 days', 145000.00, CURRENT_DATE + INTERVAL '480 days',
      'operational', 60, CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days',
      v_sup_titan, 'Hardwood insert platform, laser-cut J-cups, magnetic safety pins.'
    )
    RETURNING id INTO v_eq_squat;

  INSERT INTO gym_equipment (
    asset_tag, name, category, brand, model_number, serial_number, floor_zone,
    purchase_date, purchase_cost, warranty_until, condition_status, maintenance_interval_days,
    last_serviced_date, next_service_due, supplier_id, notes
  )
  VALUES 
    (
      'PC-EQ-003', 'Apex Slat-Belt Curved High-Speed Treadmill', 'Cardio Machines',
      'Woodway Apex', 'SLAT-CRV-04', 'SN-WW-77210', 'Cardio Loft',
      CURRENT_DATE - INTERVAL '300 days', 210000.00, CURRENT_DATE + INTERVAL '420 days',
      'maintenance_needed', 30, CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '10 days',
      v_sup_titan, 'Minor squeak in left drive bearing. Preventive bearing grease scheduled.'
    )
    RETURNING id INTO v_eq_treadmill;

  INSERT INTO gym_equipment (
    asset_tag, name, category, brand, model_number, serial_number, floor_zone,
    purchase_date, purchase_cost, warranty_until, condition_status, maintenance_interval_days,
    last_serviced_date, next_service_due, supplier_id, notes
  )
  VALUES 
    (
      'PC-EQ-004', 'Urethane Commercial Dumbbell Set (2.5kg - 50kg)', 'Free Weights',
      'Titan Urethane', 'DB-SET-50', 'SN-UD-10022', 'Free Weight Zone',
      CURRENT_DATE - INTERVAL '360 days', 160000.00, CURRENT_DATE + INTERVAL '360 days',
      'operational', 90, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '30 days',
      v_sup_titan, 'Full twin-tier rack setup with solid steel welded heads.'
    )
    RETURNING id INTO v_eq_dumbbells;

  -- 3. Seed Service History Logs
  INSERT INTO equipment_service_logs (
    equipment_id, service_date, service_type, technician_name, vendor_name, cost, parts_replaced, work_summary, condition_after
  )
  VALUES 
    (
      v_eq_cable, CURRENT_DATE - INTERVAL '12 days', 'Preventive Maintenance',
      'Rajesh Khanna', 'Titan Gym Technology', 4500.00,
      '2x High-tensile 4.8mm steel core cables',
      'Lubricated pulley bearings, replaced twin top swivel cables, balanced weight stack tension.', 'operational'
    ),
    (
      v_eq_squat, CURRENT_DATE - INTERVAL '30 days', 'Preventive Maintenance',
      'Suresh Babu', 'Titan Gym Technology', 1800.00,
      'Heavy-duty UHMW plastic J-cup liners',
      'Bolts torqued to spec, hardwood platform inspected, replaced worn J-cup wear strips.', 'operational'
    );

  -- 4. Seed Retail Inventory (Supplements, Merchandise, Accessories)
  INSERT INTO retail_inventory (
    sku, name, category, brand, unit_price, cost_price, stock_quantity, reorder_threshold, unit_measure, expiry_date, supplier_id, status
  )
  VALUES 
    (
      'SUP-WHEY-ISOL-2KG', '100% Whey Protein Isolate (Chocolate Silk, 2kg)', 'Supplements',
      'Optimum Nutrition', 5499.00, 3850.00, 18, 5, 'Tubs (2kg)', CURRENT_DATE + INTERVAL '360 days', v_sup_nutrition, 'in_stock'
    ),
    (
      'SUP-CREAT-500G', 'Micronized Creatine Monohydrate (Creapure, 500g)', 'Supplements',
      'Virtex Labs', 1499.00, 850.00, 3, 6, 'Tubs (500g)', CURRENT_DATE + INTERVAL '450 days', v_sup_nutrition, 'low_stock'
    ),
    (
      'SUP-PREWK-SOUR', 'High-Stim Nitric Oxide Pre-Workout (Sour Apple, 30sv)', 'Supplements',
      'Ghost Athletics', 2899.00, 1800.00, 2, 5, 'Bottles', CURRENT_DATE + INTERVAL '240 days', v_sup_nutrition, 'low_stock'
    ),
    (
      'APP-TEE-TECH-L', 'Virtex Seamless Performance Compression Tee (L)', 'Merchandise & Apparel',
      'PulseAthletics', 1299.00, 600.00, 24, 8, 'Units', NULL, v_sup_apparel, 'in_stock'
    ),
    (
      'APP-HOOD-OVER-M', 'Heavyweight Oversized Pump Cover Hoodie (M)', 'Merchandise & Apparel',
      'PulseAthletics', 2499.00, 1200.00, 12, 4, 'Units', NULL, v_sup_apparel, 'in_stock'
    ),
    (
      'ACC-LEATH-BELT-M', '10mm Single-Prong Powerlifting Leather Lever Belt (M)', 'Gym Accessories',
      'Titan Gear', 3499.00, 1950.00, 7, 3, 'Units', NULL, v_sup_titan, 'in_stock'
    ),
    (
      'ACC-LIFT-STRAP', 'Heavy Duty Neoprene Padded Cotton Lifting Straps', 'Gym Accessories',
      'PulseAthletics', 499.00, 180.00, 35, 10, 'Pairs', NULL, v_sup_apparel, 'in_stock'
    );

  -- 5. Seed Purchase Orders
  INSERT INTO inventory_purchase_orders (
    po_code, supplier_id, order_date, expected_delivery, total_cost, status, items_summary, notes
  )
  VALUES 
    (
      'PO-2026-001', v_sup_nutrition, CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '2 days',
      24500.00, 'ordered',
      '[{"sku":"SUP-CREAT-500G","qty":15,"unitCost":850},{"sku":"SUP-PREWK-SOUR","qty":10,"unitCost":1800}]'::jsonb,
      'Urgent replenishment of low-stock creatine and pre-workout for reception pro-shop.'
    );

END $$;
