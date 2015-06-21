var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var _ = require('underscore');

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
