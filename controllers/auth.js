const User = require('../models/User');
const Dentist = require('../models/Dentist');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  let createdDentistId = null;

  try {
    const { 
      name, 
      phone, 
      email, 
      password, 
      role, 

      experience, 
      expertise, 
      workingHours 
    } = req.body;

    let dentistId = null;

    if (role === 'dentist') {
      if (!experience || !expertise || !workingHours) {
        return res.status(400).json({ 
          success: false, 
          msg: 'Please provide experience, expertise, and workingHours for dentist role' 
        });
      }

      const newDentist = await Dentist.create({
        name,
        experience,
        expertise,
        workingHours
      });

      dentistId = newDentist._id;
      createdDentistId = dentistId;
    }

    const user = await User.create({
      name,
      phone,
      email,
      password,
      role,
      dentistProfile: dentistId
    });

    sendTokenResponse(user, 201, res);

  } catch (err) {
    console.log(err.stack);
    
    if (createdDentistId) {
      await Dentist.findByIdAndDelete(createdDentistId);
    }

    res.status(400).json({ success: false });
  }
};

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        msg: 'Please provide an email and password'
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(400).json({
        success: false,
        msg: 'Invalid credentials'
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        msg: 'Invalid credentials'
      });
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    return res.status(401).json({success:false,msg:'Cannot convert email or password to string'});
  }
};

// Get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();

  const options = {
    expires: new Date(
      Date.now() +
        process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
    ),
    httpOnly: true
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        dentistProfile: user.dentistProfile, // ส่ง ID หมอกลับไปให้ Frontend ด้วย (ถ้ามี)
        createdAt: user.createdAt
      }
    });
};

// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  const user = await User.findById(req.user.id).populate('dentistProfile');

  res.status(200).json({
    success: true,
    data: user
  });
};

//@desc     Log user out / clear cookie
//@route    GET /api/v1/auth/logout
//@access   Private
exports.logout = async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    data: {}
  });
};