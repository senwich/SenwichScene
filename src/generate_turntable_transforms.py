#!/usr/bin/env python3
"""
Generate synthetic transforms.json for turntable capture.
Bypasses COLMAP for 360° rotation videos where SfM fails.
"""
import json
import math
import os
import sys
from pathlib import Path
from glob import glob


def rotation_matrix_y(angle_rad):
    """Rotation around Y axis (up)."""
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    return [
        [c, 0, s],
        [0, 1, 0],
        [-s, 0, c]
    ]


def rotation_matrix_x(angle_rad):
    """Rotation around X axis."""
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    return [
        [1, 0, 0],
        [0, c, -s],
        [0, s, c]
    ]


def mat_mult(A, B):
    """Multiply 3x3 matrices."""
    result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for i in range(3):
        for j in range(3):
            for k in range(3):
                result[i][j] += A[i][k] * B[k][j]
    return result


def generate_turntable_transforms(
    image_dir: Path,
    output_path: Path,
    camera_distance: float = 4.0,
    camera_height: float = 0.5,
    start_angle: float = 0.0,
    rotation_direction: int = 1,  # 1 = CCW, -1 = CW
    image_width: int = 0,
    image_height: int = 0,
    focal_length: float = 0.0,
):
    """
    Generate transforms.json for turntable capture.
    
    Args:
        image_dir: Directory containing frame_XXXXX.jpg images
        output_path: Output transforms.json path
        camera_distance: Distance from camera to object center
        camera_height: Height of camera above object center
        start_angle: Starting angle in degrees
        rotation_direction: 1 for CCW, -1 for CW when viewed from above
        image_width: Image width in pixels
        image_height: Image height in pixels
        focal_length: Focal length in pixels
    """
    # Find all images
    image_files = sorted(glob(str(image_dir / "frame_*.jpg")))
    if not image_files:
        image_files = sorted(glob(str(image_dir / "*.jpg")))
    if not image_files:
        image_files = sorted(glob(str(image_dir / "*.png")))
    
    if not image_files:
        print(f"No images found in {image_dir}")
        sys.exit(1)
    
    num_frames = len(image_files)
    print(f"Found {num_frames} images")

    if image_width <= 0 or image_height <= 0:
        try:
            from PIL import Image
        except Exception:
            Image = None
        if Image is not None:
            with Image.open(image_files[0]) as img:
                image_width = img.width
                image_height = img.height
        else:
            image_width = 1280
            image_height = 720

    if focal_length <= 0:
        focal_length = 0.8 * max(image_width, image_height)
    
    # Calculate angle step (360° / num_frames)
    angle_step = 2 * math.pi / num_frames
    
    frames = []
    for i, img_path in enumerate(image_files):
        # Current angle
        angle = math.radians(start_angle) + i * angle_step * rotation_direction
        
        # Camera position on circle
        cam_x = camera_distance * math.sin(angle)
        cam_z = camera_distance * math.cos(angle)
        cam_y = camera_height
        
        # Camera looks at origin
        # Forward = -Z in camera space, should point toward origin
        # We need to construct camera-to-world matrix
        
        # Camera forward direction (from camera to origin, normalized)
        forward = [-cam_x, -cam_y, -cam_z]
        forward_len = math.sqrt(sum(x*x for x in forward))
        forward = [x/forward_len for x in forward]
        
        # Up direction (world Y)
        up = [0, 1, 0]
        
        # Right = forward x up
        right = [
            forward[1] * up[2] - forward[2] * up[1],
            forward[2] * up[0] - forward[0] * up[2],
            forward[0] * up[1] - forward[1] * up[0]
        ]
        right_len = math.sqrt(sum(x*x for x in right))
        if right_len > 1e-6:
            right = [x/right_len for x in right]
        else:
            right = [1, 0, 0]
        
        # Recompute up = right x forward
        up = [
            right[1] * forward[2] - right[2] * forward[1],
            right[2] * forward[0] - right[0] * forward[2],
            right[0] * forward[1] - right[1] * forward[0]
        ]
        
        # Camera-to-world matrix (OpenGL convention: -Z forward, Y up, X right)
        # Columns are right, up, -forward (back)
        transform_matrix = [
            [right[0], up[0], -forward[0], cam_x],
            [right[1], up[1], -forward[1], cam_y],
            [right[2], up[2], -forward[2], cam_z],
            [0, 0, 0, 1]
        ]
        
        rel_path = os.path.relpath(img_path, output_path.parent)
        frames.append({
            "file_path": rel_path,
            "transform_matrix": transform_matrix,
            "colmap_im_id": i + 1
        })
    
    # Build transforms.json
    transforms = {
        "w": image_width,
        "h": image_height,
        "fl_x": focal_length,
        "fl_y": focal_length,
        "cx": image_width / 2,
        "cy": image_height / 2,
        "k1": 0.0,
        "k2": 0.0,
        "p1": 0.0,
        "p2": 0.0,
        "camera_model": "OPENCV",
        "frames": frames,
        "applied_transform": [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0]
        ]
    }
    
    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(transforms, f, indent=4)
    
    print(f"Generated {output_path} with {len(frames)} frames")
    return transforms


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate turntable transforms.json")
    parser.add_argument("image_dir", type=Path, help="Directory with images")
    parser.add_argument("output", type=Path, help="Output transforms.json path")
    parser.add_argument("--distance", type=float, default=4.0, help="Camera distance")
    parser.add_argument("--height", type=float, default=0.5, help="Camera height")
    parser.add_argument("--start-angle", type=float, default=0.0, help="Start angle (degrees)")
    parser.add_argument("--cw", action="store_true", help="Clockwise rotation")
    parser.add_argument("--width", type=int, default=0, help="Image width (0=auto)")
    parser.add_argument("--height-px", type=int, default=0, help="Image height (0=auto)")
    parser.add_argument("--focal", type=float, default=0.0, help="Focal length (0=auto)")
    
    args = parser.parse_args()
    
    generate_turntable_transforms(
        image_dir=args.image_dir,
        output_path=args.output,
        camera_distance=args.distance,
        camera_height=args.height,
        start_angle=args.start_angle,
        rotation_direction=-1 if args.cw else 1,
        image_width=args.width,
        image_height=args.height_px,
        focal_length=args.focal,
    )
