const { promisify } = require('util');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const catchAsync = require('../utils/catchAsync');
const User = require('./../Model/userModel');
const appError = require('../utils/appError');
const sendEmail = require('../utils/email');

const signToken = (id) => {
  return jwt.sign({ id: id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIES_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.cookie('jwt', token, cookieOptions);

  // Remove the password field from output
  user.password = undefined;
  res.status(statusCode).json({
    status: 'Sucess',
    token,
    data: { user },
  });
};

exports.signup = catchAsync(async (req, res) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
    passwordChangedAt: req.body.passwordChangedAt,
    role: req.body.role,
  });
  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) check if email and password exist
  if (!email || !password) {
    return next(new appError('Please provide email and password', 400));
  }

  // 2)check if user exist && password is correct
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new appError('Incorrect Email and Password', 401));
  }

  // 3)IF everything is ok , send token to client
  createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  // 1)  Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return next(
      new appError('You are not logged in! please log  in to access', 401)
    );
  }
  // 2) Verification Token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const freshUser = await User.findById(decoded.id);
  if (!freshUser) {
    return next(
      new appError('The user belong to this token does no longer exists', 401)
    );
  }
  // 4) check if user changed password after token was issued
  if (freshUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new appError('user recently changed password please login again', 401)
    );
  }

  // Grant access to protected route
  req.user = freshUser;
  next();
});

exports.restrictTo = (...userRoles) => {
  return (req, res, next) => {
    // userRoles = ['admin','lead-guide']
    if (!userRoles.includes(req.user.role)) {
      return next(
        new appError('you do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

exports.forgortPassword = catchAsync(async (req, res, next) => {
  // 1) get user based on posted email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new appError('There is no user with email address', 404));
  }
  // 2) Generate the random token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) send it to user email
  const resetUrl = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your Password? Submit a patch request with your new password and confirm password to : ${resetUrl}. \n If you didn't forget your password, please ignore this email!`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your Password reset token (valid for 10 min)',
      message,
    });
    res.status(200).json({
      status: 'success',
      message: 'Token send to email',
    });
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save({ validateBeforeSave: false });
    return next(
      new appError(
        'There was an error sending the email . Try again later!',
        500
      )
    );
  }
});
exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) IF token has not expired , and there is user , set the new password
  if (!user) {
    return next(new appError('Token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.confirmPassword = req.body.confirmPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) update changePasswordAt property for the user - implemented in the userschma.pre('save')  method

  // 4) Log the user in , send JWT

  createSendToken(user, 200, res);
});

// this function only perform after user logged in
exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');
  // 2) Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new appError('Your current password is wrong', 401));
  }
  // 3) If so , update password
  user.password = req.body.password;
  user.confirmPassword = req.body.confirmPassword;
  await user.save();
  // 4) Log user in , send JWT
  createSendToken(user, 200, res);
});