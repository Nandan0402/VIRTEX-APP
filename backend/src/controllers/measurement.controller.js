import * as measurementRepo from '../repositories/measurement.repository.js';

export async function getBodyMeasurements(req, res) {
  try {
    const { member_id, start_date, end_date, limit } = req.query;
    const measurements = await measurementRepo.getBodyMeasurements({
      member_id,
      start_date,
      end_date,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({
      success: true,
      count: measurements.length,
      data: measurements
    });
  } catch (error) {
    console.error('Error in getBodyMeasurements:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch body measurements history.' });
  }
}

export async function getMeasurementById(req, res) {
  try {
    const { id } = req.params;
    const measurement = await measurementRepo.getMeasurementById(id);
    if (!measurement) {
      return res.status(404).json({ success: false, message: 'Measurement record not found.' });
    }
    res.json({ success: true, data: measurement });
  } catch (error) {
    console.error('Error in getMeasurementById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch measurement record.' });
  }
}

export async function recordBodyMeasurement(req, res) {
  try {
    const {
      member_id,
      weight_kg,
      height_cm,
      body_fat_pct,
      muscle_mass_kg,
      chest_cm,
      waist_cm,
      hips_cm,
      arms_cm,
      thighs_cm,
      calves_cm,
      shoulders_cm,
      neck_cm,
      notes,
      measured_by,
      logged_at
    } = req.body;

    if (!member_id || !weight_kg) {
      return res.status(400).json({
        success: false,
        message: 'Member ID and weight (kg) are required.'
      });
    }

    const newRecord = await measurementRepo.recordBodyMeasurement({
      member_id,
      weight_kg,
      height_cm,
      body_fat_pct,
      muscle_mass_kg,
      chest_cm,
      waist_cm,
      hips_cm,
      arms_cm,
      thighs_cm,
      calves_cm,
      shoulders_cm,
      neck_cm,
      notes,
      measured_by: measured_by || req.user?.username || 'Trainer',
      logged_at
    });

    res.status(201).json({
      success: true,
      message: 'Body measurement recorded successfully without modifying historical entries.',
      data: newRecord
    });
  } catch (error) {
    console.error('Error in recordBodyMeasurement:', error);
    res.status(500).json({ success: false, message: 'Failed to record body measurement.' });
  }
}

export async function getTransformationTimeline(req, res) {
  try {
    const { memberId } = req.params;
    const timeline = await measurementRepo.getTransformationTimeline(memberId);
    res.json({
      success: true,
      data: timeline
    });
  } catch (error) {
    console.error('Error in getTransformationTimeline:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transformation timeline.' });
  }
}

export async function getTransformationPhotos(req, res) {
  try {
    const { memberId } = req.params;
    const photos = await measurementRepo.getTransformationPhotos(memberId);
    res.json({
      success: true,
      count: photos.length,
      data: photos
    });
  } catch (error) {
    console.error('Error in getTransformationPhotos:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transformation photos.' });
  }
}

export async function addTransformationPhoto(req, res) {
  try {
    const {
      member_id,
      photo_url,
      photo_type,
      pose,
      phase,
      weight_at_photo,
      body_fat_at_photo,
      consent_given,
      consent_signature,
      caption,
      logged_at
    } = req.body;

    if (!member_id || !photo_url || !consent_given) {
      return res.status(400).json({
        success: false,
        message: 'Member ID, photo URL, and explicit member consent are required.'
      });
    }

    const photo = await measurementRepo.addTransformationPhoto({
      member_id,
      photo_url,
      photo_type,
      pose,
      phase,
      weight_at_photo,
      body_fat_at_photo,
      consent_given,
      consent_signature,
      caption,
      logged_at
    });

    res.status(201).json({
      success: true,
      message: 'Transformation photo recorded with member consent.',
      data: photo
    });
  } catch (error) {
    console.error('Error in addTransformationPhoto:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save transformation photo.' });
  }
}

export async function getMonthlyComparisonReport(req, res) {
  try {
    const { memberId } = req.params;
    const report = await measurementRepo.getMonthlyComparisonReport(memberId);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getMonthlyComparisonReport:', error);
    res.status(500).json({ success: false, message: 'Failed to generate monthly comparison report.' });
  }
}

export async function getMeasurementModuleKpis(req, res) {
  try {
    const kpis = await measurementRepo.getMeasurementModuleKpis();
    res.json({
      success: true,
      data: kpis
    });
  } catch (error) {
    console.error('Error in getMeasurementModuleKpis:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch measurement KPIs.' });
  }
}

