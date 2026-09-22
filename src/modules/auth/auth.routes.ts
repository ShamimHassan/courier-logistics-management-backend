import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { loginUser, registerCustomer } from './auth.service';
import { loginSchema, registerSchema } from './auth.validation';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  const payload = registerSchema.parse(req.body);
  const user = await registerCustomer(payload);

  res.status(StatusCodes.CREATED).json(
    successResponse('Customer account created successfully', { user }),
  );
});

router.post('/login', async (req: Request, res: Response) => {
  const payload = loginSchema.parse(req.body);
  const user = await loginUser(payload);

  res.status(StatusCodes.OK).json(
    successResponse('Login successful', { user }),
  );
});

export default router;
