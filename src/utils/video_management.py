import os
import time

import ffmpeg

from utils.logger_manager import logger


class VideoManagement:

    @staticmethod
    def wait_for_file_release(file, timeout=10):
        """
        Wait until the file is released (not locked anymore) or timeout is reached.
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                with open(file, 'ab'):
                    return True
            except PermissionError:
                time.sleep(0.5)
        return False

    @staticmethod
    def convert_flv_to_mp4(file):
        """
        Convert the video from flv format to mp4 format.
        Only converts if the file is actually FLV format.
        """
        # Check if file actually needs conversion
        if not file.endswith('_flv.mp4'):
            logger.info(f"File already in MP4 format, skipping conversion")
            return
            
        logger.info("Converting to MP4 format...")

        if not VideoManagement.wait_for_file_release(file):
            logger.error(f"File is still locked after waiting. Skipping conversion.")
            return

        # Check if output file already exists
        output_file = file.replace('_flv.mp4', '.mp4')
        if os.path.exists(output_file):
            logger.info(f"Output file already exists, skipping conversion")
            os.remove(file)  # Remove the source file
            return

        try:
            ffmpeg.input(file).output(
                output_file,
                c='copy',
                y='-y',
            ).run(quiet=True)
            
            # Only remove source file if conversion was successful
            if os.path.exists(output_file):
                # Verify the output file has content
                output_size = os.path.getsize(output_file)
                if output_size > 0:
                    os.remove(file)
                    logger.info("Finished converting")
                else:
                    logger.error(f"Conversion failed - output file is empty")
                    # Don't remove source file if conversion failed
            else:
                logger.error(f"Conversion failed - output file not created")
                
        except ffmpeg.Error as e:
            logger.error(f"ffmpeg error: {e.stderr.decode() if hasattr(e, 'stderr') else str(e)}")
        except Exception as e:
            logger.error(f"Conversion error: {str(e)}")