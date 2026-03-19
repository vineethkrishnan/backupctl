import { DataSource } from 'typeorm';
import { typeormConfigRaw } from '../config/typeorm.config';

const dataSource = new DataSource(typeormConfigRaw);
export default dataSource;
