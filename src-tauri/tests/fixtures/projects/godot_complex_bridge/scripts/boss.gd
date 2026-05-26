extends CharacterBody2D

func _ready():
	await get_tree().create_timer(1.0).timeout
	for child in get_children():
		child.queue_free()

func _physics_process(delta):
	velocity.x = sin(Time.get_ticks_msec()) * 40
	move_and_slide()
	get_tree().change_scene_to_file("res://scenes/next.tscn")

