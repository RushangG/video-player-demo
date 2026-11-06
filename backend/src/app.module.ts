import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VideoStreamModule } from './video-stream/video-stream.module';

@Module({
  imports: [VideoStreamModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
