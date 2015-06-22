var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var _ = require('underscore');

/***** Indexing *****/

/**
* Recursively traverse files and directories invoking the callback
* function on each element found.
*/
explore_recursive = function(dir, callback, context, base) {
  if( base==undefined ) base = path.basename(dir);
  _.map(fs.readdirSync(dir), function(file) {
    var f = path.join(dir, file); // this is the real file name on disk
    var n = path.join(base, file); // this is the file name in the archive
    var s = fs.lstatSync(f);
    if( s.isDirectory() ) {
      context = callback(n, 'D', f, context);
      explore_recursive(f, callback, context, n);
    } else if( s.isFile() ) {
      context = callback(n, 'F', f, context);
    } else {
      // FIXME: handle symbolic links and special files
      console.log("Warning: File type not supported, ignoring: "+n);
    }
  });
  return context;
};

/**
* Return file stats (see return statement).
*/
get_element = function(file, full_name) {
  if( full_name==undefined ) full_name = file;
  var s = fs.lstatSync(file), hash;
  if( s.isFile() ) {
    // hashes are only computed for files
    // FIXME: make a better helper function
    var h = cp.spawnSync('md5',['-r',file]);
    if( h.status!=0 ) {
      throw new Error(file+': '+h.error);
    }
    hash = String(h.stdout).split(' ')[0];
  }
  return {
    full_name: full_name,
    base_name: path.basename(file),
    type: (s.isDirectory()?'D':(s.isSymbolicLink()?'L':(s.isFile()?'F':'O'))),
    size: s.size,
    mode: s.mode,
    hash: hash,
  };
};

/**
* Construct an index of files for the specified directory.
*/
construct_file_index = function(dir, base) {
  return explore_recursive(dir, function(name, type, file, index) {
    index[name] = get_element(file, name);
    return index;
  }, {}, base);
};

/**
* Construct an index of objects from the specified file index.
*/
construct_object_index = function(file_index) {
  var object_index = {};
  _.map(_.values(file_index), function(element) {
    if( element.type=='F')
    {
      // hashes are only computed for files
      if( _.has(object_index, element.hash) ) {
        object_index[element.hash].refs += 1;
        object_index[element.hash].files.push(element);
      } else {
        object_index[element.hash] = {
          refs: 1,
          files: [element],
        };
      }
    }
  });
  return object_index;
}

/**
* Construct a full index of files and objects.
*/
construct_index = function(file_index) {
  return {
    files: file_index,
    objects: construct_object_index(file_index)
  };
};

/***** Handling changes *****/

/**
* Dummy callback function which only print information to stdout.
*/
var dummy_callback = {
  new: function(new_element) { console.log('new: '+new_element.full_name); },
  rename: function(old_element,new_element) { console.log('rename: '+old_element.full_name+'->'+new_element.full_name); },
  copy: function(old_element,new_element) { console.log('copy: '+old_element.full_name+'->'+new_element.full_name); },
  modify: function(old_element,new_element) { console.log('modify: '+new_element.full_name+' ('+old_element.size+' bytes -> '+new_element.size+' bytes)'); },
  modify_instance: function(old_element,new_element) { console.log('modify one instance: '+new_element.full_name+' ('+old_element.size+' bytes -> '+new_element.size+' bytes)'); },
  chmod: function(old_element,new_element) { console.log('chmod: '+new_element.full_name+' ('+old_element.mode+'->'+new_element.mode+')'); },
  unchanged: function(old_element,new_element) { console.log('no change: '+new_element.full_name); },
  delete: function(old_element) { console.log('delete: '+old_element.full_name); },
  delete_instance: function(old_element) { console.log('delete one instance: '+old_element.full_name); },
};

/**
* Detect changes and launch the appropriate callback actions.
* This is the core function of arcsavvy!
*/
compute_changes = function(start_index, end_file_index, end_element, callback) {
  if( callback==undefined ) callback = dummy_callback;

  var start_element = start_index.files[end_element.full_name];
  if( start_element==undefined ) {
    // file not found in index
    start_element = start_index.objects[end_element.hash];
    if( start_element==undefined ) {
      // hash not found
      callback.new(end_element);
    } else {
      // hash found
      if( start_element.refs==1 ) {
        start_element = start_element.files[0];
        // if end_file_index is available, then forward detection is possible
        // so we can directly rename the file, otherwise we will have to
        // first make a copy of it, and delete it later
        if( end_file_index && !_.has(end_file_index, start_element.full_name) ) {
          // file is not present anymore
          start_element.seen = true;
          callback.rename(start_element,end_element);
        } else {
          // file is still there
          callback.copy(start_element,end_element);
        }
      } else {
        // FIXME: what is the appropriate behavior?

        // there are multiple references, consider as new and emit a warning
        // console.log("Warning: Ambiguous rename, I consider the file as being new")
        // callback.new(end_element);

        // there are multiple references, consider arbitrarily as a copy of first one
        start_element = start_element.files[0];
        console.log("Warning: Ambiguous rename, I consider the file as being copy of: "+start_element.full_name);
        callback.copy(start_element,end_element);
      }
    }
  } else {
    // file found
    start_element.seen = true;
    if( start_element.size!=end_element.size || start_element.hash!=end_element.hash ) {
      // different hash or size
      var start_hash = start_index.objects[start_element.hash];
      if( start_hash.refs==1 ) {
        callback.modify(start_element,end_element);
      } else {
        callback.modify_instance(start_element,end_element);
      }
    } else if( start_element.mode!=end_element.mode ) {
      // different mode
      callback.chmod(start_element,end_element);
    } else {
      // no change detected
      callback.unchanged(start_element,end_element);
    }
  }
  return start_index;
};

/**
* Compare indexes and launch the appropriate callback actions.
* Offline = end index is already available
* Online  = end index is computed on the fly
*/
compare_indexes = function(start_index, index_or_dir, callback) {
  if( callback==undefined ) callback = dummy_callback;
  var end_file_index;

  // look for new files, renamed files and changed files
  if( index_or_dir instanceof Object )
  {
    // offline mode: end index is already available
    // iterate over end_file_index
    end_file_index = index_or_dir;
    _.map( _.values(end_file_index), function(end_element) {
      start_index = compute_changes(start_index, end_file_index, end_element, callback);
    });
  }
  else
  {
    // online mode: end index is computed on the fly
    // recursively explore dir
    var dir = index_or_dir;
    end_file_index = explore_recursive(dir, function(name, type, file, index) {
      index[name] = get_element(file, name);
      start_index = compute_changes(start_index, undefined, index[name], callback);
      return index;
    }, {}, '');
  }

  // end index is now available
  var end_index = construct_index(end_file_index);

  // look for deleted files
  _.map( _.values(start_index.files), function(start_element) {
    if( !start_element.seen ) {
      var end_element = end_index.objects[start_element.hash];
      if( end_element==undefined ) {
        callback.delete(start_element);
      } else {
        callback.delete_instance(start_element);
      }
    }
  });

  return end_index;
};

/* TODO: subdirectories */
/* TODO: detect collisions */
/* TODO: symlinks */
/* TODO: archive fast mode (using hashes) */
/* TODO: archive full mode */
/* TODO: check archive */
/* TODO: restore archive */
/* TODO: archive snapshots */
/* TODO: archive packing */
/* TODO: archive compression */
/* TODO: archive encryption */
/* TODO: archive to remote via SSH */
