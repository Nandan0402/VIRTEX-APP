/**
 * validator.js - Request Payload Validation Middlewares
 */

export function validateRobotCommand(req, res, next) {
  const { commandType, gesture, gestureName, angles, servoPayload, headPan, headTilt, armWave, head, leftArm, rightArm } = req.body;
  const gestureCandidate = gesture || gestureName;

  // 1. Strict gesture validation (WAVE, NOD, IDLE, SHAKE, LOOK_LEFT, LOOK_RIGHT and standard aliases)
  if (gestureCandidate) {
    const allowed = [
      'WAVE',
      'NOD',
      'IDLE',
      'GREET_WAVE',
      'NOD_YES',
      'RESET_IDLE',
      'SHAKE',
      'SHAKE_NO',
      'LOOK_LEFT',
      'LOOK_RIGHT',
    ];
    if (!allowed.includes(String(gestureCandidate).toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid gesture '${gestureCandidate}'. Only WAVE, NOD, and IDLE are permitted.`,
      });
    }
    return next();
  }

  if (commandType === 'GESTURE' && !gestureCandidate) {
    return res.status(400).json({
      success: false,
      error: "Missing gesture field. Only 'WAVE', 'NOD', and 'IDLE' are permitted.",
    });
  }

  // 2. Direct angles validation (from top-level fields, servoPayload, or angles)
  const payload = servoPayload || angles || {};
  const pan = headPan !== undefined ? headPan : (head !== undefined ? head : payload.headPan !== undefined ? payload.headPan : payload.head);
  const tilt = headTilt !== undefined ? headTilt : (leftArm !== undefined ? leftArm : payload.headTilt !== undefined ? payload.headTilt : payload.leftArm);
  const arm = armWave !== undefined ? armWave : (rightArm !== undefined ? rightArm : payload.armWave !== undefined ? payload.armWave : payload.rightArm);

  if (pan !== undefined || tilt !== undefined || arm !== undefined) {
    if (pan !== undefined && (isNaN(pan) || pan < 0 || pan > 180)) {
      return res.status(400).json({ success: false, error: 'headPan must be between 0 and 180 degrees.' });
    }
    if (tilt !== undefined && (isNaN(tilt) || tilt < 45 || tilt > 135)) {
      return res.status(400).json({ success: false, error: 'headTilt must be between 45 and 135 degrees.' });
    }
    if (arm !== undefined && (isNaN(arm) || arm < 0 || arm > 160)) {
      return res.status(400).json({ success: false, error: 'armWave must be between 0 and 160 degrees.' });
    }
    return next();
  }

  // 3. Strict commandType validation if specified
  if (commandType) {
    const validTypes = ['GESTURE', 'DIRECT_ANGLES', 'CALIBRATE', 'EMERGENCY_STOP'];
    if (!validTypes.includes(commandType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid commandType '${commandType}'. Supported: ${validTypes.join(', ')}`,
      });
    }
    return next();
  }

  return res.status(400).json({
    success: false,
    error: 'Invalid payload: Must supply either a valid gesture name, direct angles, or commandType.',
  });
}

export function validateInteraction(req, res, next) {
  const { userQuery, robotResponse, language } = req.body;

  if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Missing or empty field: userQuery is required.' });
  }

  if (!robotResponse || typeof robotResponse !== 'string' || robotResponse.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Missing or empty field: robotResponse is required.' });
  }

  if (language && !['en-IN', 'kn-IN', 'hi-IN'].includes(language)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported language '${language}'. Supported: en-IN, kn-IN, hi-IN.`,
    });
  }

  next();
}

export function validateLogin(req, res, next) {
  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Username is required.' });
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  next();
}

export function validateRegister(req, res, next) {
  const { username, password, email, fullName, role = 'member' } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Full name is required.' });
  }

  const validRoles = ['member', 'trainer', 'admin', 'manager', 'owner'];
  if (!validRoles.includes(String(role).toLowerCase())) {
    return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  next();
}

/**
 * Validate incoming chat messages and sanitize member context
 */
export function validateChatMessage(req, res, next) {
  const { message, language, memberContext } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Message string is required.',
    });
  }

  if (message.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Message exceeds maximum length of 500 characters.',
    });
  }

  if (language && typeof language === 'string') {
    const validLanguages = ['en-in', 'kn-in', 'hi-in', 'kannada', 'hindi', 'english'];
    if (!validLanguages.includes(language.trim().toLowerCase()) && !['en-IN', 'kn-IN', 'hi-IN'].includes(language)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported language '${language}'. Supported: en-IN, kn-IN, hi-IN.`,
      });
    }
  }

  // Privacy Protection: Strip sensitive PII before any processing
  if (memberContext && typeof memberContext === 'object') {
    const allowed = ['firstName', 'name', 'membershipPlan', 'membershipTier', 'checkInStatus'];
    const sanitized = {};
    for (const key of allowed) {
      if (memberContext[key] !== undefined) {
        sanitized[key] = String(memberContext[key]).substring(0, 50);
      }
    }
    req.body.memberContext = sanitized;
  }

  next();
}

