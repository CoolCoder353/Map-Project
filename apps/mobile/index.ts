// The app's entry. Android Auto can start Wayfinder with no phone screen open, so the part that
// answers the car starts here rather than in a screen.
import { startCarController, startCarNavigationFeed } from './src/car/controller';
import { carHandlers } from './src/car/handlers';
import './src/tracking/background';
import 'expo-router/entry';

startCarController(carHandlers);
startCarNavigationFeed();
