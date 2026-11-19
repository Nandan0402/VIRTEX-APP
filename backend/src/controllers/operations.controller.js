/**
 * Virtex Admin - Gym Operations & Staff Management Controller
 * REST endpoints for staff registration, profiles, roles & permissions,
 * attendance reports, shift management, branch management, facility zones,
 * facility maintenance logs, staff performance, and branch analytics.
 */

import { operationsRepository } from '../repositories/operations.repository.js';

// ==========================================
// 1. STAFF REGISTRATION & PROFILES
// ==========================================
export async function getStaffProfiles(req, res) {
  try {
    const { branch_id, department, role, search } = req.query;
    const staff = await operationsRepository.getStaffProfiles({ branch_id, department, role, search });
    res.json({ success: true, data: staff });
  } catch (err) {
    console.error('Error fetching staff profiles:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve staff profiles' });
  }
}

export async function getStaffProfileById(req, res) {
  try {
    const { id } = req.params;
    const staff = await operationsRepository.getStaffProfileById(id);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Staff profile not found' });
    }
    res.json({ success: true, data: staff });
  } catch (err) {
    console.error('Error fetching staff profile by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve staff profile' });
  }
}

export async function registerStaff(req, res) {
  try {
    const { email, full_name, role } = req.body;
    if (!email || !full_name) {
      return res.status(400).json({ success: false, message: 'Email and Full Name are required' });
    }
    const created = await operationsRepository.registerStaff(req.body);
    res.status(201).json({ success: true, data: created, message: 'Staff member registered successfully' });
  } catch (err) {
    console.error('Error registering staff:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'A user with this username or email already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to register staff member' });
  }
}

export async function updateStaffProfile(req, res) {
  try {
    const { id } = req.params;
    const updated = await operationsRepository.updateStaffProfile(id, req.body);
    res.json({ success: true, data: updated, message: 'Staff profile updated' });
  } catch (err) {
    console.error('Error updating staff profile:', err);
    res.status(500).json({ success: false, message: 'Failed to update staff profile' });
  }
}

// ==========================================
// 2. STAFF ROLES AND PERMISSIONS
// ==========================================
export async function getRolesAndPermissions(req, res) {
  try {
    const roles = await operationsRepository.getRolesAndPermissions();
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve roles and permissions' });
  }
}

export async function updateStaffRole(req, res) {
  try {
    const { id } = req.params;
    const { role, role_id } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, message: 'Role is required' });
    }
    const updated = await operationsRepository.updateStaffRole(id, { role, role_id });
    res.json({ success: true, data: updated, message: 'Staff role updated successfully' });
  } catch (err) {
    console.error('Error updating staff role:', err);
    res.status(500).json({ success: false, message: 'Failed to update staff role' });
  }
}

// ==========================================
// 3. STAFF ATTENDANCE REPORTS (routine_punches)
// ==========================================
export async function getStaffAttendanceReports(req, res) {
  try {
    const { user_id, start_date, end_date, branch_id } = req.query;
    const report = await operationsRepository.getStaffAttendanceReports({ user_id, start_date, end_date, branch_id });
    res.json({ success: true, data: report });
  } catch (err) {
    console.error('Error fetching staff attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve attendance reports' });
  }
}

// ==========================================
// 4. STAFF SHIFT MANAGEMENT
// ==========================================
export async function getStaffShifts(req, res) {
  try {
    const { branch_id, user_id, start_date, end_date, status } = req.query;
    const shifts = await operationsRepository.getStaffShifts({ branch_id, user_id, start_date, end_date, status });
    res.json({ success: true, data: shifts });
  } catch (err) {
    console.error('Error fetching shifts:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve staff shifts' });
  }
}

export async function createStaffShift(req, res) {
  try {
    const { user_id, branch_id, shift_date, shift_type } = req.body;
    if (!user_id || !branch_id || !shift_date || !shift_type) {
      return res.status(400).json({ success: false, message: 'Staff user ID, branch, shift date, and shift type are required' });
    }
    const shift = await operationsRepository.createStaffShift(req.body);
    res.status(201).json({ success: true, data: shift, message: 'Shift scheduled successfully' });
  } catch (err) {
    console.error('Error scheduling shift:', err);
    res.status(500).json({ success: false, message: 'Failed to schedule shift' });
  }
}

export async function updateStaffShiftStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }
    const updated = await operationsRepository.updateStaffShiftStatus(id, status);
    res.json({ success: true, data: updated, message: `Shift marked ${status}` });
  } catch (err) {
    console.error('Error updating shift status:', err);
    res.status(500).json({ success: false, message: 'Failed to update shift status' });
  }
}

// ==========================================
// 5. BRANCH MANAGEMENT
// ==========================================
export async function getBranches(req, res) {
  try {
    const branches = await operationsRepository.getBranches();
    res.json({ success: true, data: branches });
  } catch (err) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve branches' });
  }
}

export async function createBranch(req, res) {
  try {
    const { code, name, address } = req.body;
    if (!code || !name || !address) {
      return res.status(400).json({ success: false, message: 'Branch code, name, and address are required' });
    }
    const branch = await operationsRepository.createBranch(req.body);
    res.status(201).json({ success: true, data: branch, message: 'Branch created successfully' });
  } catch (err) {
    console.error('Error creating branch:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'A branch with this code already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create branch' });
  }
}

export async function updateBranch(req, res) {
  try {
    const { id } = req.params;
    const updated = await operationsRepository.updateBranch(id, req.body);
    res.json({ success: true, data: updated, message: 'Branch details updated' });
  } catch (err) {
    console.error('Error updating branch:', err);
    res.status(500).json({ success: false, message: 'Failed to update branch' });
  }
}

// ==========================================
// 6. FACILITY MANAGEMENT
// ==========================================
export async function getFacilities(req, res) {
  try {
    const { branch_id, status } = req.query;
    const facilities = await operationsRepository.getFacilities({ branch_id, status });
    res.json({ success: true, data: facilities });
  } catch (err) {
    console.error('Error fetching facilities:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve facilities' });
  }
}

export async function createFacility(req, res) {
  try {
    const { branch_id, zone_name, facility_type } = req.body;
    if (!branch_id || !zone_name || !facility_type) {
      return res.status(400).json({ success: false, message: 'Branch ID, zone name, and facility type are required' });
    }
    const facility = await operationsRepository.createFacility(req.body);
    res.status(201).json({ success: true, data: facility, message: 'Facility zone added' });
  } catch (err) {
    console.error('Error creating facility:', err);
    res.status(500).json({ success: false, message: 'Failed to add facility zone' });
  }
}

export async function updateFacilityStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }
    const updated = await operationsRepository.updateFacilityStatus(id, status);
    res.json({ success: true, data: updated, message: `Facility status updated to ${status}` });
  } catch (err) {
    console.error('Error updating facility status:', err);
    res.status(500).json({ success: false, message: 'Failed to update facility status' });
  }
}

// ==========================================
// 7. FACILITY MAINTENANCE
// ==========================================
export async function getFacilityMaintenanceLogs(req, res) {
  try {
    const { branch_id, facility_id, status } = req.query;
    const logs = await operationsRepository.getFacilityMaintenanceLogs({ branch_id, facility_id, status });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error fetching facility maintenance logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve maintenance logs' });
  }
}

export async function createFacilityMaintenanceLog(req, res) {
  try {
    const { facility_id, branch_id, maintenance_type, technician_name } = req.body;
    if (!facility_id || !branch_id || !maintenance_type || !technician_name) {
      return res.status(400).json({ success: false, message: 'Facility ID, branch ID, maintenance type, and technician are required' });
    }
    const log = await operationsRepository.createFacilityMaintenanceLog(req.body);
    res.status(201).json({ success: true, data: log, message: 'Facility maintenance scheduled' });
  } catch (err) {
    console.error('Error creating maintenance log:', err);
    res.status(500).json({ success: false, message: 'Failed to schedule maintenance' });
  }
}

export async function updateFacilityMaintenanceStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, completed_date, notes } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }
    const updated = await operationsRepository.updateFacilityMaintenanceStatus(id, { status, completed_date, notes });
    res.json({ success: true, data: updated, message: `Maintenance ticket status updated to ${status}` });
  } catch (err) {
    console.error('Error updating maintenance status:', err);
    res.status(500).json({ success: false, message: 'Failed to update maintenance status' });
  }
}

// ==========================================
// 8. STAFF PERFORMANCE REPORTS
// ==========================================
export async function getStaffPerformanceReports(req, res) {
  try {
    const reports = await operationsRepository.getStaffPerformanceReports();
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('Error fetching staff performance:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve staff performance reports' });
  }
}

// ==========================================
// 9. BRANCH-WISE ANALYTICS
// ==========================================
export async function getBranchAnalytics(req, res) {
  try {
    const analytics = await operationsRepository.getBranchAnalytics();
    res.json({ success: true, data: analytics });
  } catch (err) {
    console.error('Error fetching branch analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve branch analytics' });
  }
}

