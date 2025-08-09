import os
import time
import shutil

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
            # First, try the standard copy method (fastest)
            try:
                ffmpeg.input(file).output(
                    output_file,
                    c='copy',
                    y='-y',
                ).run(quiet=True, overwrite_output=True)
                
            except ffmpeg.Error as e:
                # If copy fails, try re-encoding with different codecs
                logger.warning("Direct copy failed, trying re-encoding...")
                
                # Try with libx264 and aac
                try:
                    ffmpeg.input(file).output(
                        output_file,
                        vcodec='libx264',
                        acodec='aac',
                        preset='fast',
                        crf=23,
                        y='-y',
                    ).run(quiet=True, overwrite_output=True)
                    
                except ffmpeg.Error as e2:
                    # Last resort: try with more compatible settings
                    logger.warning("Standard re-encoding failed, trying compatibility mode...")
                    
                    ffmpeg.input(file).output(
                        output_file,
                        vcodec='libx264',
                        acodec='aac',
                        preset='ultrafast',
                        pix_fmt='yuv420p',
                        movflags='faststart',
                        y='-y',
                    ).run(quiet=True, overwrite_output=True)
            
            # Verify conversion success
            if os.path.exists(output_file):
                output_size = os.path.getsize(output_file)
                if output_size > 0:
                    # Check if the output file is actually playable
                    try:
                        # Quick probe to verify the file is valid
                        probe = ffmpeg.probe(output_file)
                        if probe.get('streams'):
                            os.remove(file)
                            logger.info("Finished converting")
                            return
                        else:
                            raise Exception("Output file has no valid streams")
                    except Exception as probe_error:
                        logger.error(f"Converted file is not valid: {probe_error}")
                        # Don't remove source file if output is invalid
                        if os.path.exists(output_file):
                            os.remove(output_file)
                        return
                else:
                    logger.error(f"Conversion failed - output file is empty")
                    if os.path.exists(output_file):
                        os.remove(output_file)
                    return
            else:
                logger.error(f"Conversion failed - output file not created")
                return
                
        except ffmpeg.Error as e:
            error_msg = e.stderr.decode() if hasattr(e, 'stderr') and e.stderr else str(e)
            logger.error(f"FFmpeg conversion error: {error_msg}")
            
            # Check if it's a codec issue
            if "codec" in error_msg.lower() and "not implemented" in error_msg.lower():
                logger.error("FFmpeg version is too old for this video codec. Please update FFmpeg to version 5.0 or later.")
                logger.error("Installation commands:")
                logger.error("Ubuntu/Debian: sudo apt update && sudo apt install -y software-properties-common && sudo add-apt-repository ppa:jonathonf/ffmpeg-4 && sudo apt update && sudo apt install ffmpeg")
                logger.error("CentOS/RHEL: sudo yum install -y epel-release && sudo yum install -y ffmpeg")
                logger.error("Or compile from source: https://ffmpeg.org/download.html#build-linux")
            
            # Don't remove source file if conversion failed
            if os.path.exists(output_file):
                os.remove(output_file)
                
        except Exception as e:
            logger.error(f"Conversion error: {str(e)}")
            # Don't remove source file if conversion failed
            if os.path.exists(output_file):
                os.remove(output_file)